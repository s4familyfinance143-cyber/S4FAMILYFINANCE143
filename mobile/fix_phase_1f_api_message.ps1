$path = ".\src\app\index.tsx"
$raw = Get-Content $path -Raw

$backup = ".\src\app\index.tsx.bak-api-message-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item $path $backup -Force

$raw = $raw.Replace(
'  const [apiStatus, setApiStatus] = useState<"idle" | "ok" | "failed">("idle");
  const [loginUser, setLoginUser] = useState<LoginUser | null>(null);',
'  const [apiStatus, setApiStatus] = useState<"idle" | "ok" | "failed">("idle");
  const [apiMessage, setApiMessage] = useState("API not tested yet.");
  const [loginUser, setLoginUser] = useState<LoginUser | null>(null);'
)

$old = @'
  async function checkApiConnection() {
    try {
      setApiStatus("idle");

      const response = await fetch(`${API_BASE_URL}/`, {
        method: "GET",
      });

      if (!response.ok) {
        setApiStatus("failed");
        Alert.alert("API Failed", `Backend response status: ${response.status}`);
        return;
      }

      setApiStatus("ok");
      Alert.alert("API Connected", "Mobile app backend API ধরতে পারছে।");
    } catch (error) {
      setApiStatus("failed");
      Alert.alert(
        "API Connection Failed",
        "Phone থেকে backend ধরতে পারছে না। Backend --host 0.0.0.0 দিয়ে চালাও এবং phone + PC same Wi-Fi check করো।"
      );
    }
  }
'@

$new = @'
  async function checkApiConnection() {
    try {
      setApiStatus("idle");
      setApiMessage("Testing backend API...");

      const response = await fetch(`${API_BASE_URL}/`, {
        method: "GET",
      });

      if (!response.ok) {
        setApiStatus("failed");
        setApiMessage(`API failed. Backend response status: ${response.status}`);
        return;
      }

      const text = await response.text();
      setApiStatus("ok");
      setApiMessage(`API connected successfully. ${text.slice(0, 80)}`);
    } catch (error) {
      setApiStatus("failed");
      setApiMessage(
        "API connection failed. Backend --host 0.0.0.0 দিয়ে চালাও, IP/Wi-Fi/firewall check করো।"
      );
    }
  }
'@

$raw = $raw.Replace($old, $new)

$raw = $raw.Replace(
'            <Pressable onPress={checkApiConnection} style={styles.apiButton}>
              <Text style={styles.apiButtonText}>Test API Connection</Text>
            </Pressable>',
'            <Pressable onPress={checkApiConnection} style={styles.apiButton}>
              <Text style={styles.apiButtonText}>Test API Connection</Text>
            </Pressable>

            <Text style={styles.apiMessage}>{apiMessage}</Text>'
)

$raw = $raw.Replace(
'  apiButtonText: {
    color: "#f6c65b",
    fontSize: 13,
    fontWeight: "900",
  },',
'  apiButtonText: {
    color: "#f6c65b",
    fontSize: 13,
    fontWeight: "900",
  },
  apiMessage: {
    color: "#b8c9c1",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 10,
  },'
)

Set-Content $path $raw -Encoding UTF8

Write-Host "PHASE 1F API MESSAGE FIX DONE"
Write-Host "Backup:" $backup