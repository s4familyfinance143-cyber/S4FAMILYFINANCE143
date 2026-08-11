from pathlib import Path

p = Path("src/App.css")
text = p.read_text(encoding="utf-8")

css = r'''
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  width: min(700px, 95vw);
  max-height: 85vh;
  overflow-y: auto;
  background: #0b1f45;
  border: 1px solid #23497d;
  border-radius: 24px;
  padding: 24px;
  color: #ffffff;
}

.modal-card h3 {
  color: #ffd42a;
  margin-bottom: 16px;
}

.modal-card input,
.modal-card textarea {
  width: 100%;
  min-height: 56px;
  margin-bottom: 14px;
  border-radius: 12px;
  border: 1px solid #334155;
  background: #020b1f;
  color: white;
  padding: 14px;
  font-size: 16px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.modal-actions button {
  background: #2563eb;
  color: white;
  border-radius: 12px;
  padding: 12px 18px;
  font-weight: 800;
}
'''

if ".modal-overlay" in text:
    print("MODAL CSS ALREADY EXISTS")
else:
    p.write_text(text + "\n" + css, encoding="utf-8")
    print("MODAL CSS INSERTED OK")
