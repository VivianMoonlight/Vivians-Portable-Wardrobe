import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

/**
 * React replacement for the Vue `DialogService` (which mounted DialogModal.vue
 * via `createApp`). Exposes promise-based `alert`/`confirm`/`prompt` through the
 * `useDialog()` hook, rendered with a single Mantine `Modal` inside the Shadow DOM.
 */
type DialogKind = 'alert' | 'confirm' | 'prompt'

interface DialogRequest {
  kind: DialogKind
  message: string
  title?: string
  defaultValue?: string
  resolve: (value: unknown) => void
}

export interface DialogApi {
  alert: (message: string, title?: string) => Promise<void>
  confirm: (message: string, title?: string) => Promise<boolean>
  prompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>
}

const DialogContext = createContext<DialogApi | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = useState('')

  const open = useCallback(
    (req: Omit<DialogRequest, 'resolve'>) =>
      new Promise<unknown>((resolve) => {
        setInputValue(req.defaultValue ?? '')
        setRequest({ ...req, resolve })
      }),
    [],
  )

  const api = useMemo<DialogApi>(
    () => ({
      alert: (message, title) => open({ kind: 'alert', message, title }).then(() => undefined),
      confirm: (message, title) => open({ kind: 'confirm', message, title }).then(Boolean),
      prompt: (message, defaultValue, title) =>
        open({ kind: 'prompt', message, defaultValue, title }).then(
          (v) => (v as string | null) ?? null,
        ),
    }),
    [open],
  )

  const settle = (value: unknown) => {
    request?.resolve(value)
    setRequest(null)
  }

  // Result when the user dismisses (Esc / overlay / Cancel).
  const dismissValue = request?.kind === 'confirm' ? false : request?.kind === 'prompt' ? null : undefined
  const confirmValue =
    request?.kind === 'alert' ? undefined : request?.kind === 'confirm' ? true : inputValue

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        opened={request !== null}
        onClose={() => settle(dismissValue)}
        title={request?.title}
        centered
        withCloseButton={request?.kind !== 'alert'}
      >
        <Stack>
          <Text size="sm">{request?.message}</Text>
          {request?.kind === 'prompt' && (
            <TextInput
              data-autofocus
              value={inputValue}
              onChange={(event) => setInputValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') settle(confirmValue)
              }}
            />
          )}
          <Group justify="flex-end">
            {request?.kind !== 'alert' && (
              <Button variant="default" onClick={() => settle(dismissValue)}>
                {t('fileItem.cancel')}
              </Button>
            )}
            <Button onClick={() => settle(confirmValue)}>OK</Button>
          </Group>
        </Stack>
      </Modal>
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}
