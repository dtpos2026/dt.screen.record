import { useCallback, useState, type ReactNode } from 'react'
import { Button, Modal } from './ui'

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
}

/** Promise-based in-app confirmation dialog (keeps the branded look). */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), [])
  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }
  const node = pending ? (
    <Modal
      title={pending.title}
      onClose={() => close(false)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{pending.confirmLabel}</Button>
        </>
      }
    >
      <div className="muted">{pending.message}</div>
    </Modal>
  ) : null
  return [node, ask]
}
