import { useEffect, useState } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { ask, open } from "@tauri-apps/plugin-dialog";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AppSettings, WorkspaceGroup, WorkspaceInfo } from "@/types";
import { isDefaultWorkspacePath } from "@/features/workspaces/utils/defaultWorkspace";

type GroupedWorkspace = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type ProjectsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onCreateWorkspaceGroup: (name: string) => Promise<WorkspaceGroup | null>;
  onRenameWorkspaceGroup: (id: string, name: string) => Promise<boolean | null>;
  onDeleteWorkspaceGroup: (id: string) => Promise<boolean | null>;
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: GroupedWorkspace[];
  onAssignWorkspaceGroup: (
    workspaceId: string,
    groupId: string | null,
  ) => Promise<boolean | null>;
  ungroupedLabel: string;
  onMoveWorkspace: (id: string, direction: "up" | "down") => void;
  onDeleteWorkspace: (id: string) => void;
};

export function ProjectsSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  onCreateWorkspaceGroup,
  onRenameWorkspaceGroup,
  onDeleteWorkspaceGroup,
  workspaceGroups,
  groupedWorkspaces,
  onAssignWorkspaceGroup,
  ungroupedLabel,
  onMoveWorkspace,
  onDeleteWorkspace,
}: ProjectsSectionProps) {
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => {
    setGroupDrafts((prev) => {
      const next: Record<string, string> = {};
      workspaceGroups.forEach((group) => {
        next[group.id] = prev[group.id] ?? group.name;
      });
      return next;
    });
  }, [workspaceGroups]);

  const trimmedGroupName = newGroupName.trim();
  const canCreateGroup = Boolean(trimmedGroupName);

  const handleCreateGroup = async () => {
    setGroupError(null);
    try {
      const created = await onCreateWorkspaceGroup(newGroupName);
      if (created) {
        setNewGroupName("");
        setCreateGroupOpen(false);
      }
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRenameGroup = async (group: WorkspaceGroup) => {
    const draft = groupDrafts[group.id] ?? "";
    const trimmed = draft.trim();
    if (!trimmed || trimmed === group.name) {
      setGroupDrafts((prev) => ({
        ...prev,
        [group.id]: group.name,
      }));
      return;
    }
    setGroupError(null);
    try {
      await onRenameWorkspaceGroup(group.id, trimmed);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
      setGroupDrafts((prev) => ({
        ...prev,
        [group.id]: group.name,
      }));
    }
  };

  const updateGroupCopiesFolder = async (
    groupId: string,
    copiesFolder: string | null,
  ) => {
    setGroupError(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        workspaceGroups: appSettings.workspaceGroups.map((entry) =>
          entry.id === groupId ? { ...entry, copiesFolder } : entry,
        ),
      });
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleChooseGroupCopiesFolder = async (group: WorkspaceGroup) => {
    const selection = await open({ multiple: false, directory: true });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    await updateGroupCopiesFolder(group.id, selection);
  };

  const handleClearGroupCopiesFolder = async (group: WorkspaceGroup) => {
    if (!group.copiesFolder) {
      return;
    }
    await updateGroupCopiesFolder(group.id, null);
  };

  const handleDeleteGroup = async (group: WorkspaceGroup) => {
    const groupProjects =
      groupedWorkspaces.find((entry) => entry.id === group.id)?.workspaces ??
      [];
    const detail =
      groupProjects.length > 0
        ? `\n\n${t("settings.deleteGroupWarning")} "${ungroupedLabel}".`
        : "";
    const confirmed = await ask(
      `${t("common.delete")} "${group.name}"?${detail}`,
      {
        title: t("settings.deleteGroupTitle"),
        kind: "warning",
        okLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
      },
    );
    if (!confirmed) {
      return;
    }
    setGroupError(null);
    try {
      await onDeleteWorkspaceGroup(group.id);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    if (sourceIndex === destinationIndex) {
      return;
    }

    const newGroups = Array.from(workspaceGroups);
    const [moved] = newGroups.splice(sourceIndex, 1);
    newGroups.splice(destinationIndex, 0, moved);

    // Update sortOrder based on the new index to persist the order
    const updatedGroups = newGroups.map((group, index) => ({
      ...group,
      sortOrder: index,
    }));

    void onUpdateAppSettings({
      ...appSettings,
      workspaceGroups: updatedGroups,
    });
  };

  if (!active) {
    return null;
  }

  const visibleGroupedWorkspaces = groupedWorkspaces
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter(
        (workspace) => !isDefaultWorkspacePath(workspace.path),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
  const visibleProjectsCount = visibleGroupedWorkspaces.reduce(
    (total, group) => total + group.workspaces.length,
    0,
  );

  return (
    <section className="settings-section">
      <div className="settings-subsection-header">
        <div className="settings-subsection-title">{t("settings.groupsTitle")}</div>
        <Popover
          open={createGroupOpen}
          onOpenChange={(open) => {
            setCreateGroupOpen(open);
            if (!open) {
              setNewGroupName("");
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              className="ghost icon-button"
              aria-label={t("settings.addGroupButton")}
            >
              <Plus aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="settings-create-group-popover">
            <div className="settings-popover-content">
              <div className="settings-field-label">
                {t("settings.createGroup")}
              </div>
              <input
                className="settings-input settings-input--compact"
                value={newGroupName}
                autoFocus
                placeholder={t("settings.newGroupPlaceholder")}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canCreateGroup) {
                    event.preventDefault();
                    void handleCreateGroup();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setCreateGroupOpen(false);
                    setNewGroupName("");
                  }
                }}
              />
              <div className="settings-popover-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  className="settings-popover-cancel"
                  onClick={() => {
                    setCreateGroupOpen(false);
                    setNewGroupName("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!canCreateGroup}
                  className="settings-popover-confirm"
                  onClick={() => {
                    void handleCreateGroup();
                  }}
                >
                  {t("common.create")}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="settings-subsection-subtitle">
        {t("settings.groupsDescription")}
      </div>
      <div className="settings-groups">
        {groupError && <div className="settings-group-error">{groupError}</div>}
        {workspaceGroups.length > 0 ? (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="settings-group-list">
              {(provided) => (
                <div
                  className="settings-group-list"
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {workspaceGroups.map((group, index) => (
                    <Draggable
                      key={group.id}
                      draggableId={group.id}
                      index={index}
                    >
                      {(draggableProvided, snapshot) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className={`settings-group-row ${
                            snapshot.isDragging ? "is-dragging" : ""
                          }`}
                          style={draggableProvided.draggableProps.style}
                        >
                          <span
                            className="settings-group-drag-handle"
                            {...draggableProvided.dragHandleProps}
                          >
                            <GripVertical aria-hidden />
                          </span>

                          <div className="settings-group-name">
                            {renamingGroupId === group.id ? (
                              <input
                                className="settings-input settings-input--compact"
                                value={groupDrafts[group.id] ?? group.name}
                                autoFocus
                                onChange={(event) =>
                                  setGroupDrafts((prev) => ({
                                    ...prev,
                                    [group.id]: event.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  void handleRenameGroup(group);
                                  setRenamingGroupId(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void handleRenameGroup(group);
                                    setRenamingGroupId(null);
                                  }
                                  if (event.key === "Escape") {
                                    setGroupDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: group.name,
                                    }));
                                    setRenamingGroupId(null);
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="settings-group-name-text"
                                onDoubleClick={() => setRenamingGroupId(group.id)}
                              >
                                {group.name}
                              </span>
                            )}
                          </div>

                          {group.copiesFolder && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="settings-group-folder-indicator">
                                    <FolderOpen aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>{group.copiesFolder}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="ghost icon-button"
                                aria-label={t("settings.groupMoreActions")}
                              >
                                <MoreHorizontal aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onSelect={() => setRenamingGroupId(group.id)}
                              >
                                <Pencil aria-hidden />
                                {t("settings.renameGroup")}
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <FolderOpen aria-hidden />
                                  {t("settings.copiesFolder")}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void handleChooseGroupCopiesFolder(group);
                                    }}
                                  >
                                    {t("settings.chooseEllipsis")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void handleClearGroupCopiesFolder(group);
                                    }}
                                    disabled={!group.copiesFolder}
                                  >
                                    {t("settings.clear")}
                                  </DropdownMenuItem>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  void handleDeleteGroup(group);
                                }}
                              >
                                <Trash2 aria-hidden />
                                {t("settings.deleteGroupAction")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <div className="settings-empty">{t("settings.noGroupsYet")}</div>
        )}
      </div>
      <div className="settings-subsection-title">{t("settings.projectsSubsectionTitle")}</div>
      <div className="settings-subsection-subtitle">
        {t("settings.projectsSubsectionDescription")}
      </div>
      <div className="settings-projects">
        {visibleGroupedWorkspaces.map((group) => (
          <div key={group.id ?? "ungrouped"} className="settings-project-group">
            <div className="settings-project-group-label">{group.name}</div>
            {group.workspaces.map((workspace, index) => {
              const groupValue =
                workspaceGroups.some(
                  (entry) => entry.id === workspace.settings.groupId,
                )
                  ? workspace.settings.groupId ?? ""
                  : "";
              return (
                <div key={workspace.id} className="settings-project-row">
                  <div className="settings-project-info">
                    <div className="settings-project-name">{workspace.name}</div>
                    <div className="settings-project-path">{workspace.path}</div>
                  </div>
                  <div className="settings-project-actions">
                    <select
                      className="settings-select settings-select--compact"
                      value={groupValue}
                      onChange={(event) => {
                        const nextGroupId = event.target.value || null;
                        void onAssignWorkspaceGroup(
                          workspace.id,
                          nextGroupId,
                        );
                      }}
                    >
                      <option value="">{ungroupedLabel}</option>
                      {workspaceGroups.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onMoveWorkspace(workspace.id, "up")}
                      disabled={index === 0}
                      aria-label={t("settings.moveProjectUp")}
                    >
                      <ChevronUp aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onMoveWorkspace(workspace.id, "down")}
                      disabled={index === group.workspaces.length - 1}
                      aria-label={t("settings.moveProjectDown")}
                    >
                      <ChevronDown aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onDeleteWorkspace(workspace.id)}
                      aria-label={t("settings.deleteProject")}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {visibleProjectsCount === 0 && (
          <div className="settings-empty">{t("settings.noProjectsYet")}</div>
        )}
      </div>
    </section>
  );
}
