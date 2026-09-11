/**
 * Document capture — camera barcode already in GroceryBarcodeCamera.
 * Document pick always available; camera capture when expo-image-picker is installed.
 */
import * as DocumentPicker from "expo-document-picker";

export type ScannedDocument = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  source: "document_picker" | "camera";
};

export async function pickDocument(): Promise<ScannedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || "document",
    mimeType: asset.mimeType,
    size: asset.size,
    source: "document_picker",
  };
}

export async function captureDocumentPhoto(): Promise<ScannedDocument | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Camera permission required for document scan");
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: `scan-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
      size: asset.fileSize,
      source: "camera",
    };
  } catch (err) {
    if (err instanceof Error && /Cannot find module/.test(err.message)) {
      throw new Error("expo-image-picker not installed — use pickDocument() or install expo-image-picker");
    }
    throw err;
  }
}

/** Expo-managed substitute for Google ML Kit document scanner. */
export const documentScanner = {
  pickDocument,
  captureDocumentPhoto,
  engine: "expo-document-picker+camera" as const,
  note: "Full ML Kit requires custom native module; Expo path uses document picker + camera capture.",
};
