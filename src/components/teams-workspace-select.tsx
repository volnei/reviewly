import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamOrganization } from "@/effect/schema";

const organizationName = (organization: TeamOrganization) =>
  organization.displayName ?? organization.login;

export function TeamsWorkspaceSelect({
  organizations,
  value,
  onValueChange,
}: {
  organizations: ReadonlyArray<TeamOrganization>;
  value: string | null;
  onValueChange: (value: string) => void;
}) {
  const selected = organizations.find((organization) => organization.id === value);

  if (!selected) return <span className="text-[12px] text-ink-3">No Teams workspace</span>;
  if (organizations.length === 1) {
    return <span className="text-[12px] text-ink-3">{organizationName(selected)}</span>;
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-ink-3">
      <span>Workspace</span>
      <Select value={value} onValueChange={(next) => next !== null && onValueChange(next)}>
        <SelectTrigger
          aria-label="Workspace"
          size="sm"
          className="min-w-0 border-0 bg-transparent px-2 text-ink shadow-none hover:bg-raise/55 dark:bg-transparent"
        >
          <SelectValue>{organizationName(selected)}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {organizations.map((organization) => (
            <SelectItem key={organization.id} value={organization.id}>
              {organizationName(organization)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
