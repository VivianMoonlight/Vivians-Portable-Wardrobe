import { useEffect, useRef, useState } from 'react'
import { Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, useFsSelector, type WardrobeSyncConflict } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'

interface SyncConflictReviewProps {
  conflicts: WardrobeSyncConflict[]
  mobile: boolean
  onBack: () => void
}

function candidateName(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') return value.name
  return null
}

export function SyncConflictReview({ conflicts, mobile, onBack }: SyncConflictReviewProps) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const outfits = useFsSelector((fs) => fs.outfits)
  const tags = useFsSelector((fs) => fs.tags)
  const [resolving, setResolving] = useState<string | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const hasMissingChange = conflicts.some((conflict) => conflict.type === 'missing-device')
  const tagNames = new Map(tags.flatMap((tag) => [tag.id, ...tag.aliasIds].map((id) => [id, tag.name] as const)))

  useEffect(() => {
    if (mobile) backRef.current?.focus({ preventScroll: true })
  }, [mobile])

  const itemName = (conflict: WardrobeSyncConflict) => {
    const current = outfits.find((item) => item.id === conflict.id)?.name
      ?? tags.find((item) => item.aliasIds.includes(conflict.id))?.name
    return current ?? candidateName(conflict.local) ?? candidateName(conflict.remote)
      ?? candidateName(conflict.base) ?? `${t('library.conflict.unnamed')} ${conflict.id.slice(0, 8)}`
  }

  const summary = (value: unknown, field: string) => {
    if (value == null) return t('library.conflict.deleted')
    if ((field === 'cloudSync' || field === 'enabled') && typeof value === 'boolean') {
      return t(value ? 'library.cloudIncluded' : 'library.localOnly')
    }
    if (field === 'name' && typeof value === 'string') return value
    if (field === 'tagIds' && Array.isArray(value)) {
      const names = value.map((id) => tagNames.get(String(id))).filter(Boolean)
      return names.length ? names.join(' · ') : t('library.conflict.tagCount', { count: value.length })
    }
    if (field === 'data' && Array.isArray(value)) {
      const names = value.slice(0, 4).map((part) => part && typeof part === 'object' && 'Name' in part
        ? String(part.Name) : '').filter(Boolean)
      return `${t('library.conflict.partCount', { count: value.length })}${names.length ? ` · ${names.join(', ')}` : ''}`
    }
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return candidateName(value) ?? t('library.conflict.changed')
  }

  const resolve = async (conflict: WardrobeSyncConflict, choice: 'local' | 'cloud' | 'discard') => {
    if (choice === 'discard' && !await dialog.confirm(t('library.conflict.discardConfirm'))) return
    const key = `${conflict.kind}:${conflict.id}:${conflict.field}`
    setResolving(key)
    try {
      const ok = getFs().resolveSyncConflict([{ kind: conflict.kind, id: conflict.id, field: conflict.field, choice }])
      if (!ok) await dialog.alert(t('library.conflict.resolveFailed'))
    } catch (error) {
      await dialog.alert(t('library.operationFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setResolving(null)
    }
  }

  const choiceLabel = (conflict: WardrobeSyncConflict, choice: 'local' | 'cloud') => {
    if (conflict.type === 'delete-edit') {
      return conflict[choice === 'local' ? 'local' : 'remote'] == null
        ? t('library.conflict.keepDeletion')
        : t(conflict.kind === 'tag' ? 'library.conflict.restoreAsNewTag' : 'library.conflict.restoreAsNewOutfit')
    }
    return t(choice === 'local' ? 'library.conflict.keepLocal' : 'library.conflict.keepCloud')
  }

  return (
    <Box component="section" aria-label={t('library.conflict.title')} className="vpw-sync-conflict-review"
      style={{ display: 'flex', flexDirection: 'column', height: mobile ? '100%' : 'min(65dvh, 620px)', minHeight: 0 }}>
      {mobile && <Group gap="xs" mb="sm" wrap="nowrap">
        <Button ref={backRef} variant="subtle" size="compact-sm" onClick={onBack}>{t('library.conflict.back')}</Button>
        <Text fw={700} size="sm">{t('library.conflict.title')}</Text>
      </Group>}
      <Text size="sm" c="dimmed" mb="sm">{t(hasMissingChange ? 'library.conflict.quarantineIntro' : 'library.conflict.intro')}</Text>
      <Box style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: 1, minHeight: 0 }}>
        <Stack gap="sm" pb="sm">
          {conflicts.map((conflict) => {
            const key = `${conflict.kind}:${conflict.id}:${conflict.field}`
            const missing = conflict.type === 'missing-device'
            const label = t(`library.conflict.fields.${conflict.field}`, { defaultValue: t('library.conflict.changed') })
            return <Paper key={key} withBorder radius="md" p="sm">
              <Stack gap="xs">
                <Text size="sm" fw={700}>{missing ? t('library.conflict.missingTitle')
                  : t('library.conflict.itemTitle', { name: itemName(conflict), field: label })}</Text>
                {missing ? <Text size="sm">{t('library.conflict.missingExplanation')}</Text>
                  : <>
                    <Text size="xs" c="dimmed">{t(conflict.type === 'delete-edit' ? 'library.conflict.deleteEditExplanation'
                      : conflict.type === 'privacy' ? 'library.conflict.privacyExplanation'
                        : 'library.conflict.chooseExplanation')}</Text>
                    <Group align="stretch" gap="xs" grow>
                      <Paper withBorder p="xs" radius="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <Text size="xs" fw={700}>{t('library.conflict.thisDevice')}</Text>
                        <Text size="xs">{summary(conflict.local, conflict.field)}</Text>
                      </Paper>
                      <Paper withBorder p="xs" radius="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <Text size="xs" fw={700}>{t('library.conflict.cloud')}</Text>
                        <Text size="xs">{summary(conflict.remote, conflict.field)}</Text>
                      </Paper>
                    </Group>
                  </>}
                <Group gap="xs" justify="flex-end">
                  {missing ? <>
                    <Button variant="default" size="xs" onClick={onBack}>{t('library.conflict.waitForDevice')}</Button>
                    <Button color="red" variant="light" size="xs" disabled={resolving !== null}
                      onClick={() => void resolve(conflict, 'discard')}>{t('library.conflict.discardMissing')}</Button>
                  </> : <>
                    <Button variant="default" size="xs" disabled={resolving !== null}
                      onClick={() => void resolve(conflict, 'local')}>{choiceLabel(conflict, 'local')}</Button>
                    <Button variant="light" size="xs" disabled={resolving !== null}
                      onClick={() => void resolve(conflict, 'cloud')}>{choiceLabel(conflict, 'cloud')}</Button>
                  </>}
                </Group>
              </Stack>
            </Paper>
          })}
        </Stack>
      </Box>
    </Box>
  )
}
