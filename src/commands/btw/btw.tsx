import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterval } from 'usehooks-ts'
import type { CommandResultDisplay } from '../../commands.js'
import { Markdown } from '../../components/Markdown.js'
import {
  computeWheelStep,
  initWheelAccel,
  readScrollSpeedBase,
  scrollUp,
  type WheelAccelState,
} from '../../components/ScrollKeybindingHandler.js'
import { SpinnerGlyph } from '../../components/Spinner/SpinnerGlyph.js'
import TextInput from '../../components/TextInput.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import {
  useIsInsideModal,
  useModalOrTerminalSize,
} from '../../context/modalContext.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import ScrollBox, { type ScrollBoxHandle } from '../../ink/components/ScrollBox.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import { isXtermJs } from '../../ink/terminal.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { createAbortController } from '../../utils/abortController.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { errorMessage } from '../../utils/errors.js'
import { type CacheSafeParams, getLastCacheSafeParams } from '../../utils/forkedAgent.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import {
  runSideQuestion,
  type SideQuestionTurn,
} from '../../utils/sideQuestion.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

type BtwComponentProps = {
  question: string
  context: ProcessUserInputContext
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
}

const CHROME_ROWS = 5
const OUTER_CHROME_ROWS = 6
const SCROLL_LINES = 3

/**
 * Height budget when NOT inside the modal slot (the default: fullscreen needs
 * USER_TYPE=ant). There, /btw renders at the tail of the normal output flow
 * (REPL's `bottom` slot) with nothing bounding it — FullscreenLayout's
 * `maxHeight="50%"` wrapper and the modal's `maxHeight` only exist on the
 * fullscreen path. Sizing the transcript from the full terminal height made
 * the overlay ~one screen tall, so it pushed the transcript out of view and
 * overdrew the prompt below it. Cap it the same way Settings does for its
 * non-modal case.
 */
const NON_MODAL_MAX_ROWS = 30
const NON_MODAL_MIN_ROWS = 15
const NON_MODAL_SCREEN_FRACTION = 0.8

/**
 * `/btw` overlay: a side conversation that shares the main thread's context
 * (and prompt cache) but runs as a separate, tool-less agent.
 *
 * Multi-turn works by replaying prior turns into each forked request (see
 * runSideQuestion) — each request is still a single turn. Keys:
 *   Enter            send the typed follow-up
 *   Esc / Ctrl+C / D dismiss (Space no longer dismisses — it used to fire on
 *                    a stray press while scrolling)
 *   mouse wheel /    scroll the transcript (wheel is the 'Scroll' context's
 *   trackpad         scroll:lineUp/lineDown bindings + the shared accel curve)
 *   ↑/↓, Ctrl+P/N    scroll a few lines (arrows only while no input focus)
 *   PgUp/PgDn        scroll a page
 *   Home/End         jump to top / bottom (while no input focus)
 */
function BtwSideQuestion({ question, context, onDone }: BtwComponentProps) {
  const [turns, setTurns] = useState<SideQuestionTurn[]>([])
  const [input, setInput] = useState('')
  // Start true: the mount effect asks the command's question immediately, and
  // the input must not be usable (or visible) before that first request.
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [cursorOffset, setCursorOffset] = useState(0)
  const scrollRef = useRef<ScrollBoxHandle>(null)
  const abortRef = useRef<AbortController | null>(null)
  const wheelAccelRef = useRef<WheelAccelState | null>(null)

  const size = useModalOrTerminalSize(useTerminalSize())
  const rows = size.rows
  const columns = size.columns

  // Inside the modal, `rows` is the pane's own budget. Outside it, `rows` is
  // the whole terminal and the overlay has to share the screen with the
  // transcript and prompt — bound it to a fraction of the screen.
  const insideModal = useIsInsideModal()
  const heightBudget = insideModal
    ? rows
    : Math.max(
        NON_MODAL_MIN_ROWS,
        Math.min(Math.floor(rows * NON_MODAL_SCREEN_FRACTION), NON_MODAL_MAX_ROWS),
      )
  const maxContentHeight = Math.max(
    5,
    heightBudget - CHROME_ROWS - OUTER_CHROME_ROWS,
  )

  useInterval(() => setFrame(f => f + 1), pending ? 80 : null)

  const scrollToBottom = useCallback(() => {
    // Deferred: the transcript grows on the commit that renders the new turn,
    // so pin after paint rather than before.
    setTimeout(() => scrollRef.current?.scrollToBottom(), 0)
  }, [])

  // Send the whole turn list; the caller appends the response.
  const ask = useCallback(
    async (history: SideQuestionTurn[]) => {
      const controller = createAbortController()
      abortRef.current = controller
      setPending(true)
      setError(null)
      try {
        const cacheSafeParams = await buildCacheSafeParams(context)
        const result = await runSideQuestion({ history, cacheSafeParams })
        if (!controller.signal.aborted) {
          if (result.response) {
            setTurns(prev => [
              ...prev,
              { role: 'assistant', text: result.response as string },
            ])
            scrollToBottom()
          } else {
            setError('No response received')
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(errorMessage(err) || 'Failed to get response')
        }
      } finally {
        if (!controller.signal.aborted) setPending(false)
      }
    },
    [context, scrollToBottom],
  )

  // Ask the question passed to /btw on mount.
  useEffect(() => {
    const first: SideQuestionTurn[] = [{ role: 'user', text: question }]
    setTurns(first)
    void ask(first)
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask once for the command's question
  }, [])

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim()
      if (!text || pending) return
      const next: SideQuestionTurn[] = [...turns, { role: 'user', text }]
      setTurns(next)
      setInput('')
      setCursorOffset(0)
      scrollToBottom()
      void ask(next)
    },
    [turns, pending, ask, scrollToBottom],
  )

  const inputFocused = !pending && error === null
  // A "page" is one viewport of transcript — keep the two in lockstep so
  // PgUp/PgDn never scroll past what the user can actually see.
  const page = maxContentHeight

  // Trackpad / mouse wheel. The 'Scroll' context binds wheelup/wheeldown to
  // scroll:lineUp/lineDown (defaultBindings), and useKeybindings resolves
  // those against its own context list — so this works without the 'Scroll'
  // context being registered as active. Runs the same accel curve the
  // transcript uses, so the feel matches (iTerm2 sends one event per notch,
  // a trackpad sends a burst).
  //
  // Requires the popup to have mouse tracking on (REPL's alt frame) —
  // otherwise the terminal never sends the wheel sequence at all.
  const wheelScroll = useCallback((dir: 1 | -1) => {
    const box = scrollRef.current
    // Content fits: nothing to scroll, don't touch the position.
    if (!box || box.getScrollHeight() <= box.getViewportHeight()) return
    wheelAccelRef.current ??= initWheelAccel(isXtermJs(), readScrollSpeedBase())
    const step = computeWheelStep(wheelAccelRef.current, dir, performance.now())
    if (dir < 0) {
      scrollUp(box, step)
      return
    }
    const max = Math.max(0, box.getScrollHeight() - box.getViewportHeight())
    // Include pendingDelta — scrollBy accumulates without moving scrollTop,
    // so getScrollTop() alone is stale inside a burst of wheel events.
    if (box.getScrollTop() + box.getPendingDelta() + step >= max) {
      box.scrollToBottom()
      return
    }
    box.scrollBy(step)
  }, [])

  useKeybindings(
    {
      'scroll:lineUp': () => {
        wheelScroll(-1)
      },
      'scroll:lineDown': () => {
        wheelScroll(1)
      },
    },
    { context: 'Scroll' },
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'escape' || (e.ctrl && (e.key === 'c' || e.key === 'd'))) {
        e.preventDefault()
        onDone(undefined, { display: 'skip' })
        return
      }
      // Page/ctrl scrolling works even while the input has focus.
      if (e.key === 'pageup') {
        e.preventDefault()
        scrollRef.current?.scrollBy(-page)
        return
      }
      if (e.key === 'pagedown') {
        e.preventDefault()
        scrollRef.current?.scrollBy(page)
        return
      }
      if (e.ctrl && e.key === 'p') {
        e.preventDefault()
        scrollRef.current?.scrollBy(-SCROLL_LINES)
        return
      }
      if (e.ctrl && e.key === 'n') {
        e.preventDefault()
        scrollRef.current?.scrollBy(SCROLL_LINES)
        return
      }
      // Arrow/Home/End only when the input is NOT focused, so they stay
      // available for text navigation while the user is typing.
      if (inputFocused) return
      if (e.key === 'up') {
        e.preventDefault()
        scrollRef.current?.scrollBy(-SCROLL_LINES)
      } else if (e.key === 'down') {
        e.preventDefault()
        scrollRef.current?.scrollBy(SCROLL_LINES)
      } else if (e.key === 'home') {
        e.preventDefault()
        scrollRef.current?.scrollTo(0)
      } else if (e.key === 'end') {
        e.preventDefault()
        scrollRef.current?.scrollToBottom()
      }
    },
    [onDone, page, inputFocused],
  )

  // The header already shows the first question, so the transcript starts at
  // the first answer (index 1).
  const transcript = turns.slice(1)

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      marginTop={1}
      tabIndex={0}
      autoFocus={true}
      onKeyDown={handleKeyDown}
    >
      <Box>
        <Text color="warning" bold={true}>
          /btw{' '}
        </Text>
        <Text dimColor={true}>{question}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2} maxHeight={maxContentHeight}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1}>
          {transcript.map((turn, i) =>
            turn.role === 'user' ? (
              <Box key={i} marginTop={1}>
                <Text color="warning" bold={true}>
                  {'> '}
                </Text>
                <Text>{turn.text}</Text>
              </Box>
            ) : (
              <Box key={i} marginTop={1}>
                <Markdown>{turn.text}</Markdown>
              </Box>
            ),
          )}
          {pending && (
            <Box marginTop={1}>
              <SpinnerGlyph frame={frame} messageColor="warning" />
              <Text color="warning">Answering...</Text>
            </Box>
          )}
          {error && (
            <Box marginTop={1}>
              <Text color="error">{error}</Text>
            </Box>
          )}
        </ScrollBox>
      </Box>
      {inputFocused && (
        <Box marginTop={1} flexDirection="row">
          <Text color="warning" bold={true}>
            {'> '}
          </Text>
          <Box flexGrow={1}>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              focus={true}
              showCursor={true}
              columns={Math.max(20, columns - 6)}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              placeholder="ask a follow-up…"
            />
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor={true}>
          {inputFocused
            ? 'Enter to send · scroll/PgUp/PgDn · Esc to dismiss'
            : '↑/↓, scroll, PgUp/PgDn to scroll · Esc to dismiss'}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Build CacheSafeParams for the side question fork.
 *
 * The preferred source is getLastCacheSafeParams — the exact
 * systemPrompt/userContext/systemContext bytes the main thread sent on its
 * last request (captured in stopHooks). Reusing them guarantees a
 * byte-identical prefix and thus a prompt cache hit. We pair these with the
 * current toolUseContext (for thinkingConfig/tools) and current messages
 * (for up-to-date context).
 *
 * Fallback (first turn before stop hooks fire, or prompt-suggestion
 * disabled): rebuild from scratch. This may miss the cache if the main loop
 * applied buildEffectiveSystemPrompt extras (--agent, --system-prompt,
 * --append-system-prompt, coordinator mode).
 */
function stripInProgressAssistantMessage(messages: Message[]): Message[] {
  const last = messages.at(-1)
  if (last?.type === 'assistant' && last.message.stop_reason === null) {
    return messages.slice(0, -1)
  }
  return messages
}

async function buildCacheSafeParams(
  context: ProcessUserInputContext,
): Promise<CacheSafeParams> {
  const forkContextMessages = getMessagesAfterCompactBoundary(
    stripInProgressAssistantMessage(context.messages),
  )
  const saved = getLastCacheSafeParams()
  if (saved) {
    return {
      systemPrompt: saved.systemPrompt,
      userContext: saved.userContext,
      systemContext: saved.systemContext,
      toolUseContext: context,
      forkContextMessages,
    }
  }
  const [rawSystemPrompt, userContext, systemContext] = await Promise.all([
    getSystemPrompt(
      context.options.tools,
      context.options.mainLoopModel,
      [],
      context.options.mcpClients,
    ),
    getUserContext(),
    getSystemContext(),
  ])
  return {
    systemPrompt: asSystemPrompt(rawSystemPrompt),
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ProcessUserInputContext,
  args: string,
): Promise<React.ReactNode> {
  const question = args?.trim()
  if (!question) {
    onDone('Usage: /btw <your question>', { display: 'system' })
    return null
  }

  saveGlobalConfig(current => ({
    ...current,
    btwUseCount: current.btwUseCount + 1,
  }))

  return <BtwSideQuestion question={question} context={context} onDone={onDone} />
}
