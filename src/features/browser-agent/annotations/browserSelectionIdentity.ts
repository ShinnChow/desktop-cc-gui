import type { BrowserUserAnnotation } from "../types";

function normalizeBrowserSelectionText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function browserSelectionIdentity(input: {
  text: string;
  selectorHint: string | null | undefined;
  role: string | null | undefined;
}): string {
  const text = normalizeBrowserSelectionText(input.text);
  const selector = input.selectorHint?.trim() ?? "";
  const role = input.role?.trim() ?? "";
  if (selector) {
    return `sel:${selector}|t:${text}`;
  }
  return `role:${role}|t:${text}`;
}



export function browserSelectionIdentityFromAnnotation(
  annotation: BrowserUserAnnotation,
): string {
  return browserSelectionIdentity({
    text:
      annotation.nearbyText ||
      annotation.userNote ||
      annotation.nearestElement?.label ||
      "",
    selectorHint: annotation.nearestElement?.selectorHint,
    role: annotation.nearestElement?.role,
  });
}

export function upsertBrowserUserAnnotation(
  annotations: BrowserUserAnnotation[],
  nextAnnotation: BrowserUserAnnotation,
): BrowserUserAnnotation[] {
  const nextIdentity = browserSelectionIdentityFromAnnotation(nextAnnotation);
  const existingIndex = annotations.findIndex(
    (item) =>
      item.annotationId === nextAnnotation.annotationId ||
      browserSelectionIdentityFromAnnotation(item) === nextIdentity,
  );
  if (existingIndex < 0) {
    return [...annotations, nextAnnotation];
  }
  const nextAnnotations = annotations.slice();
  nextAnnotations[existingIndex] = nextAnnotation;
  return nextAnnotations;
}

export function dedupeBrowserUserAnnotations(
  annotations: BrowserUserAnnotation[],
): BrowserUserAnnotation[] {
  const seenIdentities = new Set<string>();
  const uniqueAnnotations: BrowserUserAnnotation[] = [];
  for (const annotation of annotations) {
    const identity = browserSelectionIdentityFromAnnotation(annotation);
    if (seenIdentities.has(identity)) {
      continue;
    }
    seenIdentities.add(identity);
    uniqueAnnotations.push(annotation);
  }
  return uniqueAnnotations;
}
