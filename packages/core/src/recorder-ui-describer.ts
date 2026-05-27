import type { IModelConfig } from '@midscene/shared/env';
import { compositeElementInfoImg } from '@midscene/shared/img';
import type {
  MidsceneRecorderEvent,
  MidsceneRecorderPageInfo,
  MidsceneRecorderTarget,
} from '@midscene/shared/recorder';
import { callAIWithObjectResponse } from './ai-model/service-caller';
import type { Rect } from './types';

export interface DescribeRecorderUIEventInput {
  event: MidsceneRecorderEvent;
  target?: MidsceneRecorderTarget;
}

export interface DescribeRecorderUIEventOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  concurrency?: number;
}

export interface DescribeRecorderUIEventResult {
  event: MidsceneRecorderEvent;
  usedFallback: boolean;
  error?: string;
}

interface RecorderUIEventAIResponse {
  elementDescription?: string;
  replayInstruction?: string;
  actionSummary?: string;
  scrollDestinationDescription?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

const RECORDER_UI_DESCRIBER_DEFAULT_RETRIES = 2;
const RECORDER_UI_DESCRIBER_DEFAULT_RETRY_DELAY_MS = 200;
const RECORDER_UI_DESCRIBER_DEFAULT_CONCURRENCY = 2;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPendingDescription(value?: string) {
  return value?.trim() === 'AI is analyzing element...';
}

function getRecorderEventScreenshot(event: MidsceneRecorderEvent) {
  return (
    event.screenshotWithBox || event.screenshotBefore || event.screenshotAfter
  );
}

function getRecorderEventAfterScreenshot(event: MidsceneRecorderEvent) {
  return event.screenshotAfter || event.screenshotWithBox;
}

function pointToRect(
  x: number,
  y: number,
  size: number,
  pageInfo: MidsceneRecorderPageInfo,
): Rect {
  const width = pageInfo.width || size;
  const height = pageInfo.height || size;
  const left = clamp(Math.floor(x - size / 2), 0, Math.max(width - 1, 0));
  const top = clamp(Math.floor(y - size / 2), 0, Math.max(height - 1, 0));
  return {
    left,
    top,
    width: Math.min(size, Math.max(width - left, 1)),
    height: Math.min(size, Math.max(height - top, 1)),
  };
}

function getPointRectSize(event: MidsceneRecorderEvent) {
  switch (event.type) {
    case 'scroll':
      return 96;
    case 'drag':
      return 64;
    default:
      return 36;
  }
}

export function getRecorderUIEventTargetRect(
  event: MidsceneRecorderEvent,
): Rect | null {
  const rect = event.elementRect;
  if (!rect) {
    return null;
  }

  if (
    isFiniteNumber(rect.width) &&
    rect.width > 0 &&
    isFiniteNumber(rect.height) &&
    rect.height > 0 &&
    (isFiniteNumber(rect.left) || isFiniteNumber(rect.top))
  ) {
    return {
      left: rect.left || 0,
      top: rect.top || 0,
      width: rect.width,
      height: rect.height,
    };
  }

  if (isFiniteNumber(rect.x) && isFiniteNumber(rect.y)) {
    return pointToRect(rect.x, rect.y, getPointRectSize(event), event.pageInfo);
  }

  return null;
}

function getFallbackDescription(event: MidsceneRecorderEvent) {
  switch (event.type) {
    case 'navigation':
      return event.url || event.value || event.actionType || 'navigation';
    case 'scroll':
      return getPageSemanticContext(event)
        ? `${getPageSemanticContext(event)} page or scrollable region`
        : 'current visible page or scrollable region';
    case 'drag':
      return 'gesture path shown in the screenshot';
    case 'input':
      return getPageSemanticContext(event)
        ? `input field in ${getPageSemanticContext(event)}`
        : 'input field in the current visible UI';
    case 'keydown':
      return 'focused element shown in the screenshot';
    default:
      return getPageSemanticContext(event)
        ? `target element in ${getPageSemanticContext(event)}`
        : 'target element in the current visible UI';
  }
}

function getFallbackReplayInstruction(
  event: MidsceneRecorderEvent,
  elementDescription: string,
) {
  switch (event.type) {
    case 'navigation':
      return event.url
        ? `Navigate to \`${event.url}\`.`
        : `Navigate using ${elementDescription}.`;
    case 'scroll':
      return `Scroll the page/region with description "${elementDescription}" by value "${event.value || 'down'}".`;
    case 'drag':
      return `Drag through the area described as "${elementDescription}".`;
    case 'input':
      return `Input "${event.value || ''}" into the element described as "${elementDescription}".`;
    case 'keydown':
      return `Press "${event.value || 'the recorded key'}" on the element described as "${elementDescription}".`;
    default:
      return `Click on the element described as "${elementDescription}".`;
  }
}

function getFallbackActionSummary(
  event: MidsceneRecorderEvent,
  elementDescription: string,
) {
  switch (event.type) {
    case 'navigation':
      return event.url ? `Navigate to ${event.url}` : 'Navigate';
    case 'scroll':
      return `Scroll ${elementDescription}`;
    case 'drag':
      return `Drag ${elementDescription}`;
    case 'input':
      return `Input into ${elementDescription}`;
    case 'keydown':
      return `Press ${event.value || 'key'} on ${elementDescription}`;
    default:
      return `Click ${elementDescription}`;
  }
}

function getActionGuidance(event: MidsceneRecorderEvent) {
  switch (event.type) {
    case 'click':
      return 'Identify the clicked UI element by exact visible text first. If no text is visible, use role + stable surrounding context. Never describe it by coordinates or as a nearby element.';
    case 'input':
      return 'Identify the exact input field at the marker before text entry. Use visible label, placeholder, field name, or stable surrounding section. Preserve the recorded input value, but do not describe the input value as the field.';
    case 'scroll':
      return 'Identify the scrollable page/region and the destination content revealed after scrolling. Use page title, visible heading, section title, list/table name, or stable region label; never say only "more content".';
    case 'drag':
      return 'Identify the gesture start/end regions or the dragged UI control.';
    case 'keydown':
      return 'Identify the focused element or keyboard target if visible.';
    default:
      return 'Identify the UI target involved in this event.';
  }
}

function getEventRawCoordinates(event: MidsceneRecorderEvent) {
  const x = event.elementRect?.x;
  const y = event.elementRect?.y;
  if (isFiniteNumber(x) && isFiniteNumber(y)) {
    return { x, y };
  }
  return undefined;
}

function getPageSemanticContext(event: MidsceneRecorderEvent) {
  const candidates = [event.title, event.url]
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  return candidates[0];
}

function isWeakDescription(value?: string) {
  if (!value) {
    return true;
  }
  if (isPendingDescription(value)) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, '');
  return (
    normalized.length === 0 ||
    /^\(?\d+(?:\.\d+)?,\s*\d+(?:\.\d+)?\)?$/.test(normalized) ||
    normalized === 'target' ||
    normalized === 'element' ||
    normalized === 'target element' ||
    normalized === 'the element' ||
    normalized === 'page element' ||
    normalized === 'input field' ||
    normalized === 'text input' ||
    normalized === 'text field' ||
    normalized === 'search box' ||
    normalized === 'more content' ||
    normalized === 'the page' ||
    normalized === 'current page' ||
    normalized.includes('ai is analyzing element') ||
    compact.includes('坐标') ||
    compact.includes('附近') ||
    compact.includes('附近的元素') ||
    normalized.includes('coordinate') ||
    normalized.includes('near the coordinate') ||
    normalized.includes('near coordinates') ||
    normalized.includes('nearby element') ||
    normalized.includes('near the point') ||
    normalized.includes('at the point') ||
    normalized.includes('shown in the screenshot') ||
    normalized.includes('red rectangle') ||
    normalized.includes('highlighted screenshot')
  );
}

function isWeakReplayInstruction(value?: string) {
  if (!value) {
    return true;
  }
  if (isPendingDescription(value)) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, '');
  return (
    compact.includes('坐标') ||
    compact.includes('附近') ||
    normalized.includes('coordinate') ||
    normalized.includes('near the coordinate') ||
    normalized.includes('nearby element') ||
    normalized.includes('near the point') ||
    normalized.includes('at the point') ||
    normalized.includes('ai is analyzing element') ||
    normalized.includes('more content') ||
    normalized.includes('shown in the screenshot') ||
    normalized.includes('highlighted screenshot')
  );
}

function hasScrollDestination(
  replayInstruction: string,
  scrollDestinationDescription?: string,
) {
  if (
    scrollDestinationDescription &&
    !isWeakDescription(scrollDestinationDescription)
  ) {
    return true;
  }
  const normalized = replayInstruction.toLowerCase();
  return (
    normalized.includes(' until ') ||
    normalized.includes(' visible') ||
    normalized.includes(' reveal') ||
    normalized.includes(' to the ') ||
    normalized.includes(' toward ')
  );
}

async function describeWithRetry(
  event: MidsceneRecorderEvent,
  target: MidsceneRecorderTarget | undefined,
  highlightedScreenshot: string,
  modelConfig: IModelConfig,
  options: Required<
    Pick<DescribeRecorderUIEventOptions, 'maxRetries' | 'retryDelayMs'>
  >,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const afterScreenshot = getRecorderEventAfterScreenshot(event);
      const pageContext = getPageSemanticContext(event);
      const userContent: any[] = [
        {
          type: 'text',
          text: `Recorder event:
${JSON.stringify(
  {
    type: event.type,
    actionType: event.actionType,
    value: event.value,
    rawCoordinates: getEventRawCoordinates(event),
    url: event.url,
    title: event.title,
    pageContext,
    pageInfo: event.pageInfo,
    target,
    guidance: getActionGuidance(event),
  },
  null,
  2,
)}

The target or region is highlighted in the screenshot below. Convert this event into semantic replay fields.`,
        },
        {
          type: 'image_url',
          image_url: {
            url: highlightedScreenshot,
            detail: 'high',
          },
        },
      ];
      if (afterScreenshot) {
        userContent.push(
          {
            type: 'text',
            text: 'Screenshot after the recorded action, for context only:',
          },
          {
            type: 'image_url',
            image_url: {
              url: afterScreenshot,
              detail: 'high',
            },
          },
        );
      }
      const response =
        await callAIWithObjectResponse<RecorderUIEventAIResponse>(
          [
            {
              role: 'system',
              content: `You convert Studio preview recorder UI events into semantic replay instructions.

The recorder works from screenshots and mapped coordinates only. Infer stable UI intent from the highlighted screenshot.

Output JSON only:
{
  "elementDescription": "short stable target/region description",
  "replayInstruction": "one executable natural-language replay step",
  "actionSummary": "short timeline summary",
  "scrollDestinationDescription": "for scroll only: concrete newly visible destination content or goal",
  "confidence": "high" | "medium" | "low",
  "error"?: "only if no useful visual description can be inferred"
}

Rules:
- Do NOT output coordinates as the main description.
- Do NOT mention "near coordinates", "nearby element", the red marker, highlighted box, or screenshot.
- Prefer visible UI text exactly as shown, for example "使用文档" or "开始使用".
- Click/Input target quality bar:
  - Best: exact visible text, accessible label, placeholder, or control label.
  - Acceptable: role + stable surrounding context, for example "search input in the top navigation".
  - Not acceptable: coordinates, "nearby element", "target element", or "element shown in the screenshot".
- Input-specific rules:
  - The highlighted BEFORE screenshot marks the field that receives the text.
  - The screenshot after the action may show the typed value; use it only to confirm the field, not as the field description.
  - elementDescription must identify the field itself, for example "年龄 input in the basic form" or "search input in the top navigation".
  - Never use "AI is analyzing element", the typed value, or a generic "input field" as elementDescription.
- Scroll target quality bar:
  - elementDescription describes the scrollable page, panel, list, table, or section.
  - scrollDestinationDescription describes what the scroll is trying to reveal or reach, using newly visible headings, section titles, list items, or stable content from the AFTER screenshot.
  - Prefer descriptions like "集成到 Playwright - Midscene - Vision-Driven UI Automation page, scrolling toward the API reference section" or "Android API documentation page, scrolling to the installation steps section".
  - Do NOT write generic phrases like "more content", "the page", or "main scrollable area" unless no other context exists.
- Click replayInstruction format: Click on the element described as "<elementDescription>".
- Input replayInstruction format: Input "<value>" into the element described as "<elementDescription>".
- Scroll replayInstruction format: Scroll the page/region with description "<elementDescription>" by value "<recorded value>" until "<scrollDestinationDescription>" is visible.
- Scroll actionSummary format: Scroll <elementDescription> toward <scrollDestinationDescription>.
- Drag replayInstruction format: Drag from/to the area described as "<elementDescription>".
- Keep quoted UI text in the original UI language.
- If uncertain, inspect the red-marked target and provide the best concrete visible text/role/context description. Set confidence to "low"; do not fall back to coordinates.`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
          modelConfig,
        );

      const content = response.content;
      if (content.error) {
        throw new Error(content.error);
      }
      if (isWeakDescription(content.elementDescription)) {
        throw new Error('AI returned a weak recorder event description.');
      }
      const elementDescription = content.elementDescription!.trim();
      const scrollDestinationDescription =
        event.type === 'scroll'
          ? content.scrollDestinationDescription?.trim()
          : undefined;
      const replayInstruction =
        event.type === 'scroll' && scrollDestinationDescription
          ? `Scroll the page/region with description "${elementDescription}" by value "${event.value || 'down'}" until "${scrollDestinationDescription}" is visible.`
          : content.replayInstruction?.trim() ||
            getFallbackReplayInstruction(event, elementDescription);
      if (isWeakReplayInstruction(replayInstruction)) {
        throw new Error('AI returned a weak recorder replay instruction.');
      }
      if (
        event.type === 'scroll' &&
        !hasScrollDestination(replayInstruction, scrollDestinationDescription)
      ) {
        throw new Error(
          'AI returned a scroll description without a destination.',
        );
      }
      const actionSummary =
        event.type === 'scroll' && scrollDestinationDescription
          ? `Scroll ${elementDescription} toward ${scrollDestinationDescription}`
          : content.actionSummary?.trim() ||
            getFallbackActionSummary(event, elementDescription);

      return {
        elementDescription,
        replayInstruction,
        actionSummary,
        semanticConfidence: content.confidence || 'medium',
      };
    } catch (error) {
      lastError = error;
      if (attempt < options.maxRetries) {
        await delay(options.retryDelayMs);
      }
    }
  }
  throw lastError;
}

async function createScreenshotWithBox(
  event: MidsceneRecorderEvent,
  rect: Rect,
) {
  if (event.screenshotWithBox) {
    return event.screenshotWithBox;
  }
  const screenshot = getRecorderEventScreenshot(event);
  if (!screenshot) {
    return undefined;
  }
  return compositeElementInfoImg({
    inputImgBase64: screenshot,
    size: event.pageInfo,
    elementsPositionInfo: [{ rect }],
    borderThickness: 3,
    annotationPadding: 2,
  });
}

function createFallbackEvent(
  event: MidsceneRecorderEvent,
  error: string,
  screenshotWithBox?: string,
): MidsceneRecorderEvent {
  const elementDescription =
    event.elementDescription && !isWeakDescription(event.elementDescription)
      ? event.elementDescription
      : getFallbackDescription(event);
  return {
    ...event,
    elementDescription,
    replayInstruction:
      event.replayInstruction ||
      getFallbackReplayInstruction(event, elementDescription),
    actionSummary:
      event.actionSummary ||
      getFallbackActionSummary(event, elementDescription),
    semanticConfidence: 'low',
    descriptionLoading: false,
    descriptionSource: 'fallback',
    descriptionError: error,
    screenshotWithBox: screenshotWithBox || event.screenshotWithBox,
  };
}

export async function describeRecorderUIEvent(
  input: DescribeRecorderUIEventInput,
  modelConfig: IModelConfig,
  options: DescribeRecorderUIEventOptions = {},
): Promise<DescribeRecorderUIEventResult> {
  const event = input.event;
  const rect = getRecorderUIEventTargetRect(event);
  const screenshot = getRecorderEventScreenshot(event);

  if (!rect || !screenshot) {
    const error = !rect
      ? 'Recorder event has no target rectangle.'
      : 'Recorder event has no screenshot.';
    return {
      usedFallback: true,
      event: createFallbackEvent(event, error),
    };
  }

  let screenshotWithBox: string | undefined;
  try {
    screenshotWithBox = await createScreenshotWithBox(event, rect);
    const semanticFields = await describeWithRetry(
      event,
      input.target,
      screenshotWithBox || screenshot,
      modelConfig,
      {
        maxRetries: options.maxRetries ?? RECORDER_UI_DESCRIBER_DEFAULT_RETRIES,
        retryDelayMs:
          options.retryDelayMs ?? RECORDER_UI_DESCRIBER_DEFAULT_RETRY_DELAY_MS,
      },
    );
    return {
      usedFallback: false,
      event: {
        ...event,
        ...semanticFields,
        descriptionLoading: false,
        descriptionSource: 'ai',
        descriptionError: undefined,
        screenshotWithBox: screenshotWithBox || event.screenshotWithBox,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      usedFallback: true,
      error: message,
      event: createFallbackEvent(event, message, screenshotWithBox),
    };
  }
}

export async function describeRecorderUIEvents(
  inputs: DescribeRecorderUIEventInput[],
  modelConfig: IModelConfig,
  options: DescribeRecorderUIEventOptions = {},
): Promise<DescribeRecorderUIEventResult[]> {
  const concurrency = Math.max(
    1,
    options.concurrency ?? RECORDER_UI_DESCRIBER_DEFAULT_CONCURRENCY,
  );
  const results: DescribeRecorderUIEventResult[] = new Array(inputs.length);
  let cursor = 0;

  async function worker() {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await describeRecorderUIEvent(
        inputs[index],
        modelConfig,
        options,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () =>
      worker(),
    ),
  );
  return results;
}
