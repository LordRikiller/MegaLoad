import { useToastStore } from "../stores/toastStore";

/** Copies text to the clipboard with a toast. Stops event propagation so it works inside clickable rows/cards. */
export function copyText(text: string, e?: React.MouseEvent): void {
  e?.stopPropagation();
  e?.preventDefault();
  navigator.clipboard.writeText(text).then(
    () =>
      useToastStore.getState().addToast({
        type: "success",
        title: "Copied",
        message: text,
        duration: 1500,
      }),
    () =>
      useToastStore.getState().addToast({
        type: "warning",
        title: "Copy failed",
        message: "Clipboard not available",
        duration: 2500,
      })
  );
}
