import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeRecorderUIEvent,
  describeRecorderUIEvents,
  getRecorderUIEventTargetRect,
} from '../../src/ai-model';
import { callAIWithObjectResponse } from '../../src/ai-model/service-caller';

vi.mock('../../src/ai-model/service-caller', () => ({
  callAIWithObjectResponse: vi.fn(),
}));

const modelConfig = {
  modelName: 'mock',
  modelDescription: 'mock',
  intent: 'default',
  slot: 'default',
} as const;

const screenshot =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lBtrWQAAAABJRU5ErkJggg==';

describe('recorder-ui-describer', () => {
  beforeEach(() => {
    vi.mocked(callAIWithObjectResponse).mockReset();
  });

  it('converts point-only recorder events into bounded target rectangles', () => {
    const rect = getRecorderUIEventTargetRect({
      type: 'click',
      source: 'studio-preview',
      timestamp: 1000,
      hashId: 'click-1',
      pageInfo: { width: 100, height: 80 },
      elementRect: { x: 4, y: 6 },
    });

    expect(rect).toEqual({
      left: 0,
      top: 0,
      width: 36,
      height: 36,
    });
  });

  it('marks events without screenshots as fallback descriptions', async () => {
    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'click',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'click-1',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 120, y: 160 },
        },
        target: {
          platformId: 'computer',
          label: 'DELL U2720Q',
          values: { displayId: '2' },
        },
      },
      modelConfig,
    );

    expect(result.usedFallback).toBe(true);
    expect(result.event.descriptionLoading).toBe(false);
    expect(result.event.descriptionSource).toBe('fallback');
    expect(result.event.descriptionError).toBe(
      'Recorder event has no screenshot.',
    );
    expect(result.event.elementDescription).toBe(
      'target element in the current visible UI',
    );
    expect(result.event.replayInstruction).toBe(
      'Click on the element described as "target element in the current visible UI".',
    );
    expect(result.event.semanticConfidence).toBe('low');
  });

  it('keeps batch result order when falling back', async () => {
    const results = await describeRecorderUIEvents(
      [
        {
          event: {
            type: 'scroll',
            source: 'studio-preview',
            timestamp: 1000,
            hashId: 'scroll-1',
            pageInfo: { width: 1280, height: 720 },
            elementRect: { x: 240, y: 360 },
          },
        },
        {
          event: {
            type: 'input',
            source: 'studio-preview',
            timestamp: 2000,
            hashId: 'input-1',
            pageInfo: { width: 1280, height: 720 },
            elementRect: { x: 320, y: 200 },
          },
        },
      ],
      modelConfig,
      { concurrency: 2 },
    );

    expect(results.map((result) => result.event.hashId)).toEqual([
      'scroll-1',
      'input-1',
    ]);
    expect(results.map((result) => result.event.descriptionSource)).toEqual([
      'fallback',
      'fallback',
    ]);
  });

  it('rejects coordinate-based AI descriptions for click events', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValueOnce({
      content: {
        elementDescription: 'element near coordinates (537, 450)',
        replayInstruction: 'Click on the element near coordinates (537, 450).',
        actionSummary: 'Click nearby element',
        confidence: 'low',
      },
    } as any);

    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'click',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'click-weak',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 537, y: 450 },
          title: 'Semi Design Form',
          screenshotWithBox: screenshot,
        },
      },
      modelConfig,
      { maxRetries: 1 },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.event.descriptionError).toBe(
      'AI returned a weak recorder event description.',
    );
    expect(result.event.elementDescription).toBe(
      'target element in Semi Design Form',
    );
  });

  it('accepts semantic scroll descriptions with page context', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValueOnce({
      content: {
        elementDescription:
          '集成到 Playwright - Midscene - Vision-Driven UI Automation page',
        scrollDestinationDescription: 'API reference section',
        replayInstruction:
          'Scroll the page/region with description "集成到 Playwright - Midscene - Vision-Driven UI Automation page" by value "0,514" until "API reference section" is visible.',
        actionSummary:
          'Scroll 集成到 Playwright - Midscene - Vision-Driven UI Automation page toward API reference section',
        confidence: 'high',
      },
    } as any);

    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'scroll',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'scroll-semantic',
          value: '0,514',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 600, y: 520 },
          title: '集成到 Playwright - Midscene - Vision-Driven UI Automation',
          screenshotWithBox: screenshot,
        },
      },
      modelConfig,
      { maxRetries: 1 },
    );

    expect(result.usedFallback).toBe(false);
    expect(result.event.elementDescription).toBe(
      '集成到 Playwright - Midscene - Vision-Driven UI Automation page',
    );
    expect(result.event.replayInstruction).toBe(
      'Scroll the page/region with description "集成到 Playwright - Midscene - Vision-Driven UI Automation page" by value "0,514" until "API reference section" is visible.',
    );
    expect(result.event.actionSummary).toBe(
      'Scroll 集成到 Playwright - Midscene - Vision-Driven UI Automation page toward API reference section',
    );
  });

  it('rejects scroll descriptions without a replay destination', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValueOnce({
      content: {
        elementDescription: 'Android - 开始使用 documentation page',
        replayInstruction:
          'Scroll the page/region with description "Android - 开始使用 documentation page" by value "down 509".',
        actionSummary: 'Scroll Android - 开始使用 documentation page',
        confidence: 'medium',
      },
    } as any);

    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'scroll',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'scroll-without-destination',
          value: 'down 509',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 600, y: 520 },
          title: 'Android - 开始使用 documentation page',
          screenshotWithBox: screenshot,
          screenshotAfter: screenshot,
        },
      },
      modelConfig,
      { maxRetries: 1 },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.event.descriptionError).toBe(
      'AI returned a scroll description without a destination.',
    );
  });

  it('accepts semantic input field descriptions and preserves the typed value', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValueOnce({
      content: {
        elementDescription: '数量 input in the basic form',
        replayInstruction:
          'Input "2" into the element described as "数量 input in the basic form".',
        actionSummary: 'Input into 数量 input in the basic form',
        confidence: 'high',
      },
    } as any);

    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'input',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'input-semantic',
          value: '2',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 537, y: 450 },
          title: 'Semi Design Form',
          screenshotWithBox: screenshot,
          screenshotAfter: screenshot,
        },
      },
      modelConfig,
      { maxRetries: 1 },
    );

    expect(result.usedFallback).toBe(false);
    expect(result.event.elementDescription).toBe(
      '数量 input in the basic form',
    );
    expect(result.event.replayInstruction).toBe(
      'Input "2" into the element described as "数量 input in the basic form".',
    );
  });

  it('rejects pending placeholder descriptions returned by AI', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValueOnce({
      content: {
        elementDescription: 'AI is analyzing element...',
        replayInstruction:
          'Input "2" into the element described as "AI is analyzing element...".',
        actionSummary: 'Input into AI is analyzing element...',
        confidence: 'low',
      },
    } as any);

    const result = await describeRecorderUIEvent(
      {
        event: {
          type: 'input',
          source: 'studio-preview',
          timestamp: 1000,
          hashId: 'input-placeholder',
          value: '2',
          pageInfo: { width: 1280, height: 720 },
          elementRect: { x: 537, y: 450 },
          title: 'Semi Design Form',
          screenshotWithBox: screenshot,
        },
      },
      modelConfig,
      { maxRetries: 1 },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.event.descriptionSource).toBe('fallback');
    expect(result.event.elementDescription).toBe(
      'input field in Semi Design Form',
    );
  });
});
