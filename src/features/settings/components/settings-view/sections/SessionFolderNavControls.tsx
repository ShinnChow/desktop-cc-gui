import type { TFunction } from "i18next";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import Folder from "lucide-react/dist/esm/icons/folder";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import Inbox from "lucide-react/dist/esm/icons/inbox";
import ListCheck from "lucide-react/dist/esm/icons/list-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionFolderNavItem } from "./sessionManagementSectionUtils";
import {
  SESSION_FOLDER_FILTER_ALL,
  SESSION_FOLDER_FILTER_ROOT,
  type SessionFolderFilter,
} from "./sessionManagementSectionHelpers";

type SessionFolderNavControlsProps = {
  workspaceDepth: number;
  sessionFolderFilter: SessionFolderFilter;
  projectScopeTotalCount: number;
  unassignedFolderCount: number;
  sessionFolderDraftOpen: boolean;
  sessionFolderDraftName: string;
  isCreatingSessionFolder: boolean;
  folderNavItems: SessionFolderNavItem[];
  sessionFoldersLoading: boolean;
  sessionFolderError: string | null;
  onFolderFilterChange: (nextFolderFilter: SessionFolderFilter) => void;
  onSessionFolderDraftOpenChange: (open: boolean) => void;
  onSessionFolderDraftNameChange: (name: string) => void;
  onCreateRootSessionFolder: () => Promise<void>;
  onNoticeClear: () => void;
  t: TFunction;
};

export function SessionFolderNavControls({
  workspaceDepth,
  sessionFolderFilter,
  projectScopeTotalCount,
  unassignedFolderCount,
  sessionFolderDraftOpen,
  sessionFolderDraftName,
  isCreatingSessionFolder,
  folderNavItems,
  sessionFoldersLoading,
  sessionFolderError,
  onFolderFilterChange,
  onSessionFolderDraftOpenChange,
  onSessionFolderDraftNameChange,
  onCreateRootSessionFolder,
  onNoticeClear,
  t,
}: SessionFolderNavControlsProps) {
  return (
    <>
      <button
        type="button"
        className={`settings-project-sessions-nav-item is-folder${sessionFolderFilter === SESSION_FOLDER_FILTER_ALL ? " is-active" : ""}`}
        style={{ paddingLeft: 10 + (workspaceDepth + 1) * 18 }}
        onClick={() =>
          onFolderFilterChange(SESSION_FOLDER_FILTER_ALL)
        }
      >
        <span className="settings-project-sessions-nav-name">
          <ListCheck size={13} aria-hidden />
          {t("settings.sessionManagementFolderAll")}
        </span>
        <span className="settings-project-sessions-nav-count">
          {projectScopeTotalCount}
        </span>
      </button>
      <button
        type="button"
        className={`settings-project-sessions-nav-item is-folder${sessionFolderFilter === SESSION_FOLDER_FILTER_ROOT ? " is-active" : ""}`}
        style={{ paddingLeft: 10 + (workspaceDepth + 1) * 18 }}
        onClick={() =>
          onFolderFilterChange(SESSION_FOLDER_FILTER_ROOT)
        }
      >
        <span className="settings-project-sessions-nav-name">
          <Inbox size={13} aria-hidden />
          {t("settings.sessionManagementFolderUnassigned")}
        </span>
        <span className="settings-project-sessions-nav-count">
          {unassignedFolderCount}
        </span>
      </button>
      {sessionFolderDraftOpen ? (
        <div
          className="settings-project-sessions-folder-draft"
          style={{ marginLeft: 10 + (workspaceDepth + 1) * 18 }}
        >
          <Input
            value={sessionFolderDraftName}
            disabled={isCreatingSessionFolder}
            autoFocus
            placeholder={t("settings.sessionManagementFolderNamePlaceholder")}
            aria-label={t("settings.sessionManagementFolderNamePlaceholder")}
            onChange={(event) => onSessionFolderDraftNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onSessionFolderDraftOpenChange(false);
                onSessionFolderDraftNameChange("");
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                void onCreateRootSessionFolder();
              }
            }}
          />
          <div className="settings-project-sessions-folder-draft-actions">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onSessionFolderDraftOpenChange(false);
                onSessionFolderDraftNameChange("");
              }}
              disabled={isCreatingSessionFolder}
            >
              <CircleX size={14} aria-hidden />
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onCreateRootSessionFolder()}
              disabled={
                !sessionFolderDraftName.trim() || isCreatingSessionFolder
              }
            >
              <FolderPlus size={14} aria-hidden />
              {isCreatingSessionFolder
                ? t("settings.sessionManagementFolderCreating")
                : t("settings.sessionManagementFolderCreate")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="settings-project-sessions-nav-item is-folder is-create"
          style={{ paddingLeft: 10 + (workspaceDepth + 1) * 18 }}
          onClick={() => {
            onSessionFolderDraftOpenChange(true);
            onSessionFolderDraftNameChange("");
            onNoticeClear();
          }}
        >
          <span className="settings-project-sessions-nav-name">
            <FolderPlus size={13} aria-hidden />
            {t("settings.sessionManagementFolderCreate")}
          </span>
        </button>
      )}
      {folderNavItems.map((folder) => (
        <button
          key={folder.id}
          type="button"
          className={`settings-project-sessions-nav-item is-folder${sessionFolderFilter === folder.id ? " is-active" : ""}`}
          style={{ paddingLeft: 10 + (workspaceDepth + 1 + folder.depth) * 18 }}
          onClick={() => onFolderFilterChange(folder.id)}
        >
          <span className="settings-project-sessions-nav-name">
            {sessionFolderFilter === folder.id ? (
              <FolderOpen size={13} aria-hidden />
            ) : (
              <Folder size={13} aria-hidden />
            )}
            {folder.label}
          </span>
          <span className="settings-project-sessions-nav-count">
            {folder.count}
          </span>
        </button>
      ))}
      {sessionFoldersLoading ? (
        <div
          className="settings-project-sessions-nav-hint"
          style={{ paddingLeft: 10 + (workspaceDepth + 1) * 18 }}
        >
          {t("settings.sessionManagementFoldersLoading")}
        </div>
      ) : null}
      {sessionFolderError ? (
        <div className="settings-project-sessions-nav-warning">
          {sessionFolderError}
        </div>
      ) : null}
    </>
  );
}
