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
import { OVERLAY_Z_INDEX } from '@/ui/z-index'

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
        title={request?.title ? <Text fw={600}>{request.title}</Text> : undefined}
        centered
        size="sm"
        radius="md"
        withCloseButton={request?.kind !== 'alert'}
        zIndex={OVERLAY_Z_INDEX}
        overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
        transitionProps={{ transition: 'pop', duration: 150 }}
      >
        <Stack gap="md">
          {request?.message && (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {request.message}
            </Text>
          )}
          {request?.kind === 'prompt' && (
            <TextInput
              data-autofocus
              value={inputValue}
              onChange={(event) => setInputValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  settle(confirmValue)
                }
              }}
            />
          )}
          <Group justify="flex-end" gap="sm" mt="xs">
            {request?.kind !== 'alert' && (
              <Button variant="default" size="sm" onClick={() => settle(dismissValue)}>
                {t('fileItem.cancel')}
              </Button>
            )}
            <Button size="sm" onClick={() => settle(confirmValue)}>
              OK
            </Button>
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
