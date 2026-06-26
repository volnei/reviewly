import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { SettingsPage } from "@/routes/settings";
import { useUi } from "@/stores/ui";

/**
 * Settings as a large centered modal instead of a full screen. Reuses the
 * SettingsPage as-is — its PageHeader doubles as the dialog header — so there's
 * one source of truth. The /settings route still renders the same page as a
 * fallback (deep links, the tray menu).
 */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="h-[82vh] w-full max-w-2xl overflow-hidden">
        <SettingsPage />
      </DialogPopup>
    </Dialog>
  );
}
