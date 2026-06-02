import { PlaygroundConversationPanel } from '@midscene/playground-app';
import type {
  ExternalRunRequest,
  FormValue,
  UniversalPlaygroundConfig,
} from '@midscene/visualizer';
import { Tooltip, message } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadStudioReport } from '../../playground/report-download';
import { useStudioPlayground } from '../../playground/useStudioPlayground';
import {
  createRecorderMarkdownReplayRequest,
  getRecorderYamlReplayContent,
} from '../../recorder/replay';
import { createStudioRecorderTargetSignature } from '../../recorder/selectors';
import type { StudioRecorderPanelMode } from '../../recorder/types';
import { useStudioRecorder } from '../../recorder/useStudioRecorder';
import { PlaygroundShell } from '../PlaygroundShell';
import { StudioRecorderPanel } from '../Recorder/StudioRecorderPanel';
import { StudioPlaygroundEmptyState } from './StudioPlaygroundEmptyState';

// Studio drives device selection from the Overview page (middle area), so the
// right column never hosts the SessionSetupPanel. This fallback replaces it
// with a calm "go to Overview" hint when no session is connected.
function NotConnectedFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[8px] px-[24px] text-center">
      <div className="text-[14px] font-medium text-text-primary">
        No agent connected
      </div>
      <div className="text-[12px] leading-[20px] text-text-secondary">
        Create or pick a device from the Overview page to start a session.
      </div>
    </div>
  );
}

declare const __APP_VERSION__: string;
declare const __STUDIO_RECORDER_ENTRY_ENABLED__: boolean;
const RIGHT_PANEL_MODE_STORAGE_KEY = 'studio.rightPanelMode';
const STUDIO_RECORDER_ENTRY_ENABLED = __STUDIO_RECORDER_ENTRY_ENABLED__;
type ReplayableCodeType = 'markdown' | 'yaml';
type StudioExternalRunRequest = ExternalRunRequest & {
  targetSignature: string | null;
};

function PlaygroundModeIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth="1.8">
      <path
        d="M4 5.5 19 12 4 18.5l3.2-6.5L4 5.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m7.5 12 5.8.02" strokeLinecap="round" />
    </svg>
  );
}

function RecorderModeIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth="1.8">
      <path
        d="M5 7.5h9.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m16.5 10.3 4-2.1v7.6l-4-2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImportReplayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-[16px] w-[16px]"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.6"
    >
      <path d="M12 4v10" stroke="currentColor" strokeLinecap="round" />
      <path
        d="m8 8 4-4 4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}

function readPersistedRightPanelMode(): StudioRecorderPanelMode {
  if (!STUDIO_RECORDER_ENTRY_ENABLED) {
    return 'playground';
  }

  if (typeof window === 'undefined') {
    return 'playground';
  }

  return window.localStorage.getItem(RIGHT_PANEL_MODE_STORAGE_KEY) ===
    'recorder'
    ? 'recorder'
    : 'playground';
}

function createExternalRunRequest(
  value: FormValue,
  displayContent: string,
  targetSignature: string | null,
): StudioExternalRunRequest {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    value,
    displayContent,
    targetSignature,
  };
}

export function createStudioPlaygroundStorageNamespace(
  targetSignature: string | null,
): string {
  return targetSignature
    ? `studio-playground-${encodeURIComponent(targetSignature)}`
    : 'studio-playground-unresolved-target';
}

export function createStudioPlaygroundConfig(
  options: {
    externalRunRequest?: ExternalRunRequest | null;
    importReplayAction?: ReactNode;
    storageNamespace?: string;
  } = {},
): Partial<UniversalPlaygroundConfig> {
  return {
    emptyState: <StudioPlaygroundEmptyState />,
    externalRunRequest: options.externalRunRequest ?? null,
    onDownloadReport: downloadStudioReport,
    persistMessages: false,
    showClearButton: true,
    storageNamespace: options.storageNamespace,
    promptInputChrome: {
      variant: 'default',
      inputActions: options.importReplayAction,
    },
  };
}

export default function Playground() {
  const studioPlayground = useStudioPlayground();
  const recorder = useStudioRecorder();
  const stopRecording = recorder.stopRecording;
  const [externalRunRequest, setExternalRunRequest] =
    useState<StudioExternalRunRequest | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<StudioRecorderPanelMode>(
    readPersistedRightPanelMode,
  );
  const currentTargetSignature = useMemo(
    () => createStudioRecorderTargetSignature(recorder.currentTarget),
    [recorder.currentTarget],
  );
  const showPlaygroundPanel = useCallback(() => {
    setRightPanelMode('playground');
    window.localStorage.setItem(RIGHT_PANEL_MODE_STORAGE_KEY, 'playground');
  }, []);
  const triggerExternalRun = useCallback(
    (value: FormValue, displayContent: string) => {
      showPlaygroundPanel();
      setExternalRunRequest(
        createExternalRunRequest(value, displayContent, currentTargetSignature),
      );
    },
    [currentTargetSignature, showPlaygroundPanel],
  );
  useEffect(() => {
    setExternalRunRequest(null);
  }, [currentTargetSignature]);
  const activeExternalRunRequest = useMemo(
    () =>
      currentTargetSignature &&
      externalRunRequest?.targetSignature === currentTargetSignature
        ? externalRunRequest
        : null,
    [currentTargetSignature, externalRunRequest],
  );
  const playgroundStorageNamespace = useMemo(
    () => createStudioPlaygroundStorageNamespace(currentTargetSignature),
    [currentTargetSignature],
  );
  const importReplayDisabledReason =
    studioPlayground.phase !== 'ready' ||
    !studioPlayground.controller.state.serverOnline ||
    !studioPlayground.controller.state.sessionViewState.connected
      ? 'Connect a target before replaying a file.'
      : null;
  const handleImportReplay = useCallback(async () => {
    try {
      if (importReplayDisabledReason) {
        message.info(importReplayDisabledReason);
        return;
      }
      if (!window.studioRuntime?.chooseReplayFile) {
        message.error('Studio replay file picker is unavailable.');
        return;
      }
      const replayFile = await window.studioRuntime.chooseReplayFile();
      if (!replayFile) {
        return;
      }
      if (replayFile.type === 'markdown') {
        triggerExternalRun(
          { type: 'runMarkdown', prompt: replayFile.path },
          `Imported Markdown Replay: ${replayFile.displayName}`,
        );
        return;
      }
      triggerExternalRun(
        { type: 'runYaml', prompt: replayFile.content },
        `Imported YAML Replay: ${replayFile.displayName}`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [importReplayDisabledReason, triggerExternalRun]);
  const importReplayAction = useMemo(
    () =>
      STUDIO_RECORDER_ENTRY_ENABLED ? (
        <Tooltip
          placement="top"
          title={importReplayDisabledReason || 'Import Markdown or YAML replay'}
        >
          <span className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center leading-none">
            <button
              aria-label="Import Markdown or YAML replay"
              className="inline-flex h-[32px] w-[32px] min-w-[32px] items-center justify-center rounded-full border border-border-subtle bg-surface p-[7px] leading-none text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={Boolean(importReplayDisabledReason)}
              onClick={handleImportReplay}
              type="button"
            >
              <ImportReplayIcon />
            </button>
          </span>
        </Tooltip>
      ) : null,
    [handleImportReplay, importReplayDisabledReason],
  );
  const playgroundConfig = useMemo(
    () =>
      createStudioPlaygroundConfig({
        externalRunRequest: activeExternalRunRequest,
        importReplayAction,
        storageNamespace: playgroundStorageNamespace,
      }),
    [activeExternalRunRequest, importReplayAction, playgroundStorageNamespace],
  );
  const modeMenuItems = useMemo(
    () =>
      STUDIO_RECORDER_ENTRY_ENABLED
        ? [
            {
              key: 'playground',
              label: 'API Playground',
              icon: <PlaygroundModeIcon />,
            },
            { key: 'recorder', label: 'Recorder', icon: <RecorderModeIcon /> },
          ]
        : [],
    [],
  );
  const handleModeSelect = useCallback(
    (key: string) => {
      if (!STUDIO_RECORDER_ENTRY_ENABLED && key === 'recorder') {
        return;
      }
      if (key !== 'playground' && key !== 'recorder') {
        return;
      }
      if (rightPanelMode === 'recorder' && key !== 'recorder') {
        void stopRecording();
      }
      if (key === 'playground') {
        showPlaygroundPanel();
        return;
      }
      setRightPanelMode('recorder');
      window.localStorage.setItem(RIGHT_PANEL_MODE_STORAGE_KEY, 'recorder');
    },
    [rightPanelMode, showPlaygroundPanel, stopRecording],
  );
  const handleReplaySession = useCallback(
    async (sessionId: string, type: ReplayableCodeType) => {
      const session = recorder.state.sessions.find(
        (item) => item.id === sessionId,
      );
      if (!session) {
        throw new Error('Recorder session not found.');
      }
      if (recorder.state.isRecording) {
        throw new Error('Stop recording before replay.');
      }
      if (
        studioPlayground.phase !== 'ready' ||
        !studioPlayground.controller.state.serverOnline ||
        !studioPlayground.controller.state.sessionViewState.connected
      ) {
        throw new Error('Connect a target before replay.');
      }
      const currentTargetSignature = createStudioRecorderTargetSignature(
        recorder.currentTarget,
      );
      if (
        !currentTargetSignature ||
        createStudioRecorderTargetSignature(session.target) !==
          currentTargetSignature
      ) {
        throw new Error('Connect the recorded target before replay.');
      }

      if (type === 'markdown') {
        if (!window.studioRuntime?.prepareRecorderMarkdownReplay) {
          throw new Error('Studio Markdown replay bridge is unavailable.');
        }
        const replay = await window.studioRuntime.prepareRecorderMarkdownReplay(
          createRecorderMarkdownReplayRequest(session),
        );
        triggerExternalRun(
          { type: 'runMarkdown', prompt: replay.markdownPath },
          `Markdown Replay: ${session.name}`,
        );
        return;
      }

      triggerExternalRun(
        { type: 'runYaml', prompt: getRecorderYamlReplayContent(session) },
        `YAML Replay: ${session.name}`,
      );
    },
    [
      recorder.currentTarget,
      recorder.state.isRecording,
      recorder.state.sessions,
      studioPlayground,
      triggerExternalRun,
    ],
  );

  useEffect(() => {
    if (!STUDIO_RECORDER_ENTRY_ENABLED && rightPanelMode === 'recorder') {
      showPlaygroundPanel();
      void stopRecording();
    }
  }, [rightPanelMode, showPlaygroundPanel, stopRecording]);

  useEffect(() => {
    return () => {
      void stopRecording();
    };
  }, [stopRecording]);

  return (
    <PlaygroundShell
      modeMenu={
        STUDIO_RECORDER_ENTRY_ENABLED
          ? {
              items: modeMenuItems,
              onSelect: handleModeSelect,
              selectedKey: rightPanelMode,
            }
          : undefined
      }
    >
      <div className="min-h-0 h-full flex-1 overflow-hidden">
        {STUDIO_RECORDER_ENTRY_ENABLED && rightPanelMode === 'recorder' ? (
          <StudioRecorderPanel onReplaySession={handleReplaySession} />
        ) : studioPlayground.phase === 'booting' ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[14px] leading-[22px] text-text-tertiary">
            Playground starting...
          </div>
        ) : studioPlayground.phase === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-[14px] leading-[22px] text-text-secondary">
              {studioPlayground.error}
            </div>
            <button
              className="rounded-lg border border-border-subtle px-4 py-2 text-[13px] font-medium text-text-primary"
              onClick={() => {
                void studioPlayground.restartPlayground();
              }}
              type="button"
            >
              Retry runtime
            </button>
          </div>
        ) : (
          <PlaygroundConversationPanel
            appVersion={__APP_VERSION__}
            className="h-full"
            controller={studioPlayground.controller}
            notConnectedFallback={<NotConnectedFallback />}
            playgroundConfig={playgroundConfig}
            title="Playground"
          />
        )}
      </div>
    </PlaygroundShell>
  );
}
