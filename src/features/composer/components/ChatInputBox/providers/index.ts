export {
  fileReferenceProvider,
  fileToDropdownItem,
} from './fileReferenceProvider';

export {
  slashCommandProvider,
  commandToDropdownItem,
} from './slashCommandProvider';

export {
  agentProvider,
  agentToDropdownItem,
  /** @deprecated No-op – kept for backward compatibility */
  setupAgentsCallback,
  forceRefreshAgents,
} from './agentProvider';

export type { AgentItem } from './agentProvider';

export {
  promptProvider,
  promptToDropdownItem,
} from './promptProvider';


