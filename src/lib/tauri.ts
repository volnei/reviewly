interface UserRef {
  login: string;
  avatar_url: string;
  html_url: string;
  id: number;
}

interface BranchRef {
  ref: string;
  sha: string;
  label: string | null;
}

interface Label {
  id: number;
  name: string;
  /** Hex color without the leading `#`. */
  color: string;
  description?: string | null;
}

export interface PullDetail {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  user: UserRef;
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  head: BranchRef;
  base: BranchRef;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged: boolean | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  commits: number | null;
  labels: Label[];
  auto_merge: { merge_method: string | null; enabled_by: UserRef | null } | null;
}

export interface PullFile {
  sha: string | null;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
}
