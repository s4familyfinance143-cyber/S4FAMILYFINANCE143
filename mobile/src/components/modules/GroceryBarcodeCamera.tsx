import React, { createElement, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";
import { CameraView, useCameraPermissions } from "expo-camera";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  lang?: MobileLang;
};

export function GroceryBarcodeCamera({ visible, onClose, onScanned, lang = "bn" }: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [webError, setWebError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      setLocked(false);
      setWebError("");
      stopWebCamera();
      return;
    }
    if (Platform.OS === "web") {
      void startWebCamera();
    }
    return () => stopWebCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function handleCode(code: string) {
    const value = String(code || "").trim();
    if (!value || locked) return;
    setLocked(true);
    onScanned(value);
    onClose();
  }

  function stopWebCamera() {
    if (typeof window !== "undefined" && timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startWebCamera() {
    setWebError("");
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setWebError("Camera API unavailable in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const video = videoRef.current;
      if (!video) {
        setWebError("Video element missing.");
        return;
      }
      video.srcObject = stream;
      await video.play();

      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setWebError("BarcodeDetector not supported — use manual barcode entry, or open on Android/iOS.");
        return;
      }
      const detector = new Detector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
      });
      timerRef.current = window.setInterval(async () => {
        try {
          if (!videoRef.current || locked) return;
          const codes = await detector.detect(videoRef.current);
          const raw = codes?.[0]?.rawValue;
          if (raw) handleCode(String(raw));
        } catch {
          // keep scanning
        }
      }, 700);
    } catch (error) {
      setWebError(error instanceof Error ? error.message : "Camera permission denied");
    }
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{tm("scanBarcode")}</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.close}>{tm("close")}</Text>
          </Pressable>
        </View>

        {Platform.OS === "web" ? (
          <View style={styles.cameraBox}>
            {createElement("video", {
              ref: videoRef,
              muted: true,
              playsInline: true,
              autoPlay: true,
              style: {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                backgroundColor: "#000",
              },
            })}
            {webError ? <Text style={styles.hint}>{webError}</Text> : <Text style={styles.hint}>{tm("pointAtBarcode")}</Text>}
          </View>
        ) : !permission ? (
          <Text style={styles.hint}>{tm("checkingCamera")}</Text>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.hint}>{tm("cameraPermissionRequired")}</Text>
            <Pressable style={styles.button} onPress={() => void requestPermission()}>
              <Text style={styles.buttonText}>{tm("allowCamera")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraBox}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
              }}
              onBarcodeScanned={locked ? undefined : ({ data }) => handleCode(data)}
            />
            <Text style={styles.hint}>{tm("pointAtBarcode")}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#06130f", padding: 16, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24 },
  title: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  close: { color: "#9ff5db", fontWeight: "800" },
  cameraBox: { flex: 1, borderRadius: 20, overflow: "hidden", backgroundColor: "#0d211b", borderColor: "#1c3b32", borderWidth: 1 },
  camera: { flex: 1 },
  hint: { color: "#9bb9ae", textAlign: "center", padding: 12, fontWeight: "700" },
  center: { flex: 1, justifyContent: "center", gap: 16, padding: 24 },
  button: { backgroundColor: "#20c997", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#04120e", fontWeight: "900" },
});
