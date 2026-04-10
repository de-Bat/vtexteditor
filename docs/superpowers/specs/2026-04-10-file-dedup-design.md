# File Deduplication — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

Skip the HTTP upload entirely when the server has already seen a file. The client computes a SHA-256 hash of the selected file before touching the network. A single lightweight check endpoint tells the client whether the file is known. On a hit, the client skips the `POST /api/media` multipart upload and asks the server to create a new project against the cached file path instead.

---

## Flow

```
User selects file
       │
       ▼
Client computes SHA-256 (Web Crypto API, ArrayBuffer)
       │
       ▼
GET /api/media/check/:hash
       │
   ┌───┴────────────────────────────┐
  HIT                              MISS
   │                                │
   ▼                                ▼
POST /api/media/from-cache        POST /api/media  (existing multipart upload)
{ hash, originalName }            FormData({ media: File })
   │                                │
   ▼                                ▼
Server creates project            Server saves file → registers hash
using cached filePath             → creates project → returns { mediaId, project }
returns { mediaId, project }
```

---

## Server Changes

### `server/src/services/file-hash-cache.ts` (new)

Module-level `Map<string, string>` (hash → absolute file path). Exposes two functions:

```ts
export function lookupHash(hash: string): string | undefined
export function registerHash(hash: string, filePath: string): void
```

In-memory only — lost on restart. A restart is rare and acceptable; the re-upload is a one-time cost.

### New route: `GET /api/media/check/:hash`

Returns `{ exists: true, filePath }` if the hash is known, `{ exists: false }` otherwise.

`filePath` is the absolute server path — never sent to the client for display, only echoed back in the `from-cache` request body so the server can create the project.

### New route: `POST /api/media/from-cache`

Body: `{ hash: string, originalName: string }`

Server looks up `hash` in the cache. If found, creates a project using the cached `filePath` (same logic as the upload handler: `getMediaInfo` → `projectService.create`). Returns `{ mediaId, project }` with status 201.

If the hash is not found (cache was cleared by restart between check and commit), returns 404 with `{ error: 'File not in cache' }` — the client falls back to a normal upload.

### Existing route: `POST /api/media`

After multer writes the file, call `registerHash(hash, filePath)`. The hash is sent by the client as the `X-File-Hash` request header alongside the multipart upload — the server reads it from `req.headers['x-file-hash']`. No change to the upload body structure.

---

## Client Changes

### `client/src/app/core/services/file-hash.service.ts` (new)

Single injectable service (`providedIn: 'root'`):

```ts
async computeHash(file: File): Promise<string>   // Web Crypto SHA-256 → hex string
checkCache(hash: string): Observable<{ exists: boolean; filePath?: string }>
```

`computeHash` reads the file as an `ArrayBuffer` via `FileReader`, passes it to `crypto.subtle.digest('SHA-256')`, converts the result to a lowercase hex string.

### `MediaUploaderComponent` changes

Replace the `private upload(file: File)` method with a two-step flow:

1. Compute hash (`await fileHashService.computeHash(file)`)
2. Call `checkCache(hash)`
3. **Hit:** call `ApiService.post('/media/from-cache', { hash, originalName: file.name })` → emit result
4. **Miss:** call `ApiService.uploadFile('/media', formData, { headers: { 'X-File-Hash': hash } })` → emit result
5. **Cache miss after hit (404 from from-cache):** fall back to normal upload (treat as miss)

Status text during hash computation: "Checking…"; during upload: "Uploading…" (existing).

---

## Data Shapes

### `GET /api/media/check/:hash` response

```ts
{ exists: true;  filePath: string }
{ exists: false }
```

### `POST /api/media/from-cache` request body

```ts
{ hash: string; originalName: string }
```

### `POST /api/media/from-cache` response

Same shape as the existing upload response:

```ts
{ mediaId: string; project: Project }
```

---

## Files to Create / Modify

### Server
- `server/src/services/file-hash-cache.ts` — new: in-memory hash → filePath map
- `server/src/routes/media.routes.ts` — add `GET /check/:hash`, `POST /from-cache`; register hash on upload

### Client
- `client/src/app/core/services/file-hash.service.ts` — new: `computeHash` + `checkCache`
- `client/src/app/features/onboarding/media-uploader/media-uploader.component.ts` — wire two-step flow

---

## Constraints & Notes

- The cache is in-memory only. A server restart clears it. The client handles a post-hit 404 gracefully by falling back to a normal upload.
- `filePath` is never shown in the browser UI — it is only echoed back in the `from-cache` body so the server can resolve the project. It is an internal server path.
- Hash computation blocks the JS thread briefly for large files; for files over ~500 MB this may be noticeable. Acceptable for V1 — chunked hashing can be added later if needed.
- The `X-File-Hash` header on the normal upload path is the only change to the multipart request structure; no changes to the FormData body.
