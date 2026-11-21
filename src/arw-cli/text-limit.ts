export const arwTextLimit = 5 * 1024 * 1024;

export function assertArwTextSize(size: number): void {
  if (size > arwTextLimit) {
    throw new Error('ARW text operations are limited to 5 MiB. Use arw download, edit locally, then arw upload.');
  }
}
