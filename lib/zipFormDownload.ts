/**
 * Browser only: asks the server for a zip with a plain form POST, so the
 * browser (iPhone Safari included) downloads the answer itself and the
 * page never holds the videos (2026-09-30). Shared by Sunnybank's act
 * zip and the Shorts episode zip.
 */
export function submitZipDownloadForm(path: string, request: unknown): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = path;
  form.style.display = "none";
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "request";
  field.value = JSON.stringify(request);
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
