/**
 * ML Kit layer — barcode + document OCR path.
 * Expo Go / managed: expo-camera barcode + document picker/camera.
 * Native (dev/prod build): optional @react-native-ml-kit/* when installed.
 */
import Constants from "expo-constants";
import { documentScanner, type ScannedDocument } from "./documentScanner";

export type BarcodeResult = {
  data: string;
  type?: string;
  engine: "expo-camera" | "mlkit" | "manual";
};

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

async function tryMlKitBarcode(_imageUri: string): Promise<BarcodeResult | null> {
  if (isExpoGo()) return null;
  try {
    // Optional native dependency — not required in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-ml-kit/barcode-scanning") as {
      default?: { scan: (uri: string) => Promise<Array<{ value: string; format?: string }>>; };
      scan?: (uri: string) => Promise<Array<{ value: string; format?: string }>>;
    };
    const api = mod.default || mod;
    if (!api?.scan) return null;
    const hits = await api.scan(_imageUri);
    const first = hits?.[0];
    if (!first?.value) return null;
    return { data: first.value, type: first.format, engine: "mlkit" };
  } catch {
    return null;
  }
}

async function tryMlKitText(_imageUri: string): Promise<string | null> {
  if (isExpoGo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-ml-kit/text-recognition") as {
      default?: { recognize: (uri: string) => Promise<{ text?: string }> };
      recognize?: (uri: string) => Promise<{ text?: string }>;
    };
    const api = mod.default || mod;
    if (!api?.recognize) return null;
    const out = await api.recognize(_imageUri);
    return out?.text || null;
  } catch {
    return null;
  }
}

/** Scan barcode from image URI (ML Kit when available). */
export async function scanBarcodeFromImage(imageUri: string): Promise<BarcodeResult | null> {
  const ml = await tryMlKitBarcode(imageUri);
  if (ml) return ml;
  return null;
}

/** OCR text from document image (ML Kit when available). */
export async function recognizeTextFromImage(imageUri: string): Promise<string | null> {
  return tryMlKitText(imageUri);
}

/** Capture document then optionally OCR. */
export async function scanDocumentWithOcr(): Promise<{
  document: ScannedDocument;
  text: string | null;
  engine: string;
}> {
  const document = await documentScanner.captureDocumentPhoto();
  if (!document) throw new Error("Document capture cancelled");
  const text = await recognizeTextFromImage(document.uri);
  return {
    document,
    text,
    engine: text ? "mlkit+camera" : documentScanner.engine,
  };
}

export const mlKit = {
  scanBarcodeFromImage,
  recognizeTextFromImage,
  scanDocumentWithOcr,
  documentScanner,
  /** Live barcode UI uses GroceryBarcodeCamera (expo-camera). */
  liveBarcodeEngine: "expo-camera" as const,
  packages: [
    "@react-native-ml-kit/barcode-scanning",
    "@react-native-ml-kit/text-recognition",
  ] as const,
  note: isExpoGo()
    ? "Expo Go: expo-camera barcode + document picker. Native ML Kit modules need a custom/dev build."
    : "Native: ML Kit modules used when linked; otherwise expo-camera/document fallback.",
};
