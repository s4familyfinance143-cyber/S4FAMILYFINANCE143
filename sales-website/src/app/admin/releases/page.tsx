"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { AdminRelease } from "@/lib/authApi";
import { adminText } from "@/lib/adminCopy";
import { products } from "@/lib/site";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

const statuses = ["draft", "available", "paused", "retired"];
const channels = ["stable", "beta", "legacy"];

async function jsonFetch<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

function productName(slug: string) {
  return products.find((product) => product.slug === slug)?.name ?? slug;
}

export default function AdminReleasesPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [releases, setReleases] = useState<AdminRelease[]>([]);
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? "");
  const [platform, setPlatform] = useState("Windows");
  const [version, setVersion] = useState("1.0.0");
  const [channel, setChannel] = useState("stable");
  const [status, setStatus] = useState("draft");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [sha256, setSha256] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [requiresLicense, setRequiresLicense] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState("");

  async function loadReleases() {
    try {
      setError("");
      setReleases(await jsonFetch<AdminRelease[]>("/api/admin/releases"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load releases.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      jsonFetch<AdminRelease[]>("/api/admin/releases")
        .then(setReleases)
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load releases.");
        });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function createRelease(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await jsonFetch<AdminRelease>("/api/admin/releases", {
        method: "POST",
        body: JSON.stringify({
          product_slug: productSlug,
          platform,
          version,
          channel,
          status,
          file_name: fileName,
          file_size: fileSize || null,
          sha256: sha256 || null,
          download_url: downloadUrl || null,
          release_notes: releaseNotes || null,
          requires_license: requiresLicense,
          is_active: isActive,
          published_at: status === "available" ? new Date().toISOString() : null,
        }),
      });
      setOk(tx("releaseSaved"));
      setFileName("");
      setFileSize("");
      setSha256("");
      setDownloadUrl("");
      setReleaseNotes("");
      await loadReleases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create release.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRelease(id: string, patch: Partial<AdminRelease>) {
    try {
      await jsonFetch<AdminRelease>(`/api/admin/releases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadReleases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update release.");
    }
  }

  async function uploadReleaseFile(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setUploadingId(id);
    setError("");
    setOk("");
    try {
      await fetch(`/api/admin/releases/${id}/file`, {
        method: "POST",
        body: form,
      }).then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Upload failed.");
      });
      setOk(tx("releaseSaved"));
      e.currentTarget.reset();
      await loadReleases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingId("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("releasesTitle")}
        subtitle={tx("releasesSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6">
          <Note tone="warn">
            {tx("releasesNote")}
          </Note>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form
            onSubmit={createRelease}
            className="flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-6"
          >
            <h2 className="text-lg font-extrabold text-text">{tx("createRelease")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <select className={inputCls} value={productSlug} onChange={(e) => setProductSlug(e.target.value)}>
                {products.map((product) => (
                  <option key={product.slug} value={product.slug}>{product.name}</option>
                ))}
              </select>
              <input className={inputCls} placeholder={tx("platform")} value={platform} onChange={(e) => setPlatform(e.target.value)} required />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input className={inputCls} placeholder={tx("version")} value={version} onChange={(e) => setVersion(e.target.value)} required />
              <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
                {channels.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <input className={inputCls} placeholder={tx("fileName")} value={fileName} onChange={(e) => setFileName(e.target.value)} required />
            <input className={inputCls} placeholder={tx("downloadUrl")} value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputCls} placeholder={tx("fileSize")} value={fileSize} onChange={(e) => setFileSize(e.target.value)} />
              <input className={inputCls} placeholder="SHA-256" value={sha256} onChange={(e) => setSha256(e.target.value)} />
            </div>
            <textarea className={`${inputCls} min-h-24 resize-y`} placeholder={tx("releaseNotes")} value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} />
            <div className="flex flex-wrap gap-4 text-sm text-muted">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={requiresLicense} onChange={(e) => setRequiresLicense(e.target.checked)} />
                {tx("requiresActiveLicense")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                {tx("activeRelease")}
              </label>
            </div>
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
            <button type="submit" disabled={busy} className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? tx("saving") : tx("createRelease")}
            </button>
          </form>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-text">{tx("releaseRegistry")}</h2>
              <button type="button" onClick={loadReleases} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent">
                {tx("refresh")}
              </button>
            </div>
            <div className="mt-5 flex max-h-[650px] flex-col gap-3 overflow-auto pr-1">
              {releases.length === 0 && <p className="text-sm text-muted">{tx("noReleases")}</p>}
              {releases.map((release) => (
                <article key={release.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-extrabold text-text">{productName(release.product_slug)}</h3>
                      <p className="mt-1 text-xs text-muted">{release.platform} · v{release.version} · {release.file_name}</p>
                    </div>
                    <select className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs text-text" value={release.status} onChange={(e) => updateRelease(release.id, { status: e.target.value })}>
                      {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>
                  <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                    <div>
                      <dt className="font-bold text-text/80">{tx("access")}</dt>
                      <dd className="mt-1">{release.requires_license ? tx("licensedCustomers") : tx("public")}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-text/80">{tx("active")}</dt>
                      <dd className="mt-1">{release.is_active ? tx("yes") : tx("no")}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-bold text-text/80">URL</dt>
                      <dd className="mt-1 break-all font-mono">{release.download_url ?? "-"}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-bold text-text/80">{tx("privateStorage")}</dt>
                      <dd className="mt-1 break-all font-mono">{release.storage_path ?? "-"}</dd>
                    </div>
                  </dl>
                  <form onSubmit={(e) => uploadReleaseFile(e, release.id)} className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-panel/30 p-3">
                    <input name="file" type="file" className="text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-bg" />
                    <button type="submit" disabled={uploadingId === release.id} className="self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-50">
                      {uploadingId === release.id ? tx("saving") : tx("uploadPrivateFile")}
                    </button>
                  </form>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => updateRelease(release.id, { is_active: !release.is_active })} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent">
                      {release.is_active ? tx("deactivate") : tx("activate")}
                    </button>
                    <button type="button" onClick={() => updateRelease(release.id, { requires_license: !release.requires_license })} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent">
                      {release.requires_license ? tx("makePublic") : tx("requireLicense")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
