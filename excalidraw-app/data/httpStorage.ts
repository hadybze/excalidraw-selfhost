import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
  IV_LENGTH_BYTES,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";
import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

// private
// -----------------------------------------------------------------------------

const HTTP_STORAGE_BACKEND_URL = import.meta.env
  .VITE_APP_HTTP_STORAGE_BACKEND_URL;

const SCENE_VERSION_LENGTH_BYTES = 4;

type HttpStoredScene = {
  sceneVersion: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: HttpStoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const decrypted = await decryptData(data.iv, data.ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

class HttpStorageSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return HttpStorageSceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    HttpStorageSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

// -----------------------------------------------------------------------------

export const isSavedToHttpStorage = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return HttpStorageSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

export const saveFilesToHttpStorage = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  void prefix;

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const response = await fetch(
          `${HTTP_STORAGE_BACKEND_URL}/files/${id}`,
          {
            method: "PUT",
            body: buffer as Uint8Array<ArrayBuffer>,
          },
        );
        if (response.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch (error: any) {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const saveToHttpStorage = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToHttpStorage(portal, elements)
  ) {
    return null;
  }

  const sceneVersion = getSceneVersion(elements);

  const getResponse = await fetch(
    `${HTTP_STORAGE_BACKEND_URL}/rooms/${roomId}`,
  );

  if (!getResponse.ok && getResponse.status !== 404) {
    return null;
  }

  let reconciledElements: SyncableExcalidrawElement[] = [...elements];

  if (getResponse.ok) {
    const buffer = await getResponse.arrayBuffer();
    const sceneVersionFromRequest = parseSceneVersionFromBuffer(buffer);

    if (sceneVersionFromRequest >= sceneVersion) {
      return null;
    }

    const existingElements = await getElementsFromBuffer(buffer, roomKey);
    reconciledElements = getSyncableElements(
      reconcileElements(
        elements,
        existingElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
        appState,
      ),
    );
  }

  const result = await saveElementsToBackend(
    roomKey,
    roomId,
    reconciledElements,
    sceneVersion,
  );

  if (!result) {
    return null;
  }

  HttpStorageSceneVersionCache.set(socket, reconciledElements);

  return toBrandedType<RemoteExcalidrawElement[]>(reconciledElements);
};

export const loadFromHttpStorage = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const response = await fetch(
    `${HTTP_STORAGE_BACKEND_URL}/rooms/${roomId}`,
  );

  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    return null;
  }

  const elements = await getElementsFromBuffer(buffer, roomKey);

  const restoredElements = getSyncableElements(
    restoreElements(elements, null, {
      deleteInvisibleElements: true,
    }),
  );

  if (socket) {
    HttpStorageSceneVersionCache.set(socket, restoredElements);
  }

  return restoredElements;
};

export const loadFilesFromHttpStorage = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  void prefix;

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const response = await fetch(
          `${HTTP_STORAGE_BACKEND_URL}/files/${id}`,
        );
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

// ---------------------------------------------------------------------------
// private helpers
// ---------------------------------------------------------------------------

const parseSceneVersionFromBuffer = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  return view.getUint32(0, false);
};

const getElementsFromBuffer = async (
  buffer: ArrayBuffer,
  key: string,
): Promise<readonly ExcalidrawElement[]> => {
  const sceneVersion = parseSceneVersionFromBuffer(buffer);
  const iv = new Uint8Array(
    buffer.slice(
      SCENE_VERSION_LENGTH_BYTES,
      SCENE_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES,
    ),
  );
  const encrypted = buffer.slice(
    SCENE_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES,
    buffer.byteLength,
  );

  return await decryptElements(
    { sceneVersion, ciphertext: encrypted, iv },
    key,
  );
};

const saveElementsToBackend = async (
  roomKey: string,
  roomId: string,
  elements: readonly SyncableExcalidrawElement[],
  sceneVersion: number,
) => {
  const { ciphertext, iv } = await encryptElements(roomKey, elements);

  const numberBuffer = new ArrayBuffer(SCENE_VERSION_LENGTH_BYTES);
  const numberView = new DataView(numberBuffer);
  numberView.setUint32(0, sceneVersion, false);

  const payload = new Uint8Array(
    numberBuffer.byteLength + iv.byteLength + ciphertext.byteLength,
  );
  payload.set(new Uint8Array(numberBuffer), 0);
  payload.set(iv, numberBuffer.byteLength);
  payload.set(new Uint8Array(ciphertext), numberBuffer.byteLength + iv.byteLength);

  const putResponse = await fetch(
    `${HTTP_STORAGE_BACKEND_URL}/rooms/${roomId}`,
    {
      method: "PUT",
      body: payload,
    },
  );

  return putResponse.ok;
};
