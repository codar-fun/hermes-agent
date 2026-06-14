import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesktopConnectionTestResult } from '@/global'
import { Check, Globe, Loader2, Monitor, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'

type View = 'choose' | 'remote'

function ModeCard({
  active,
  description,
  icon: Icon,
  onSelect,
  title
}: {
  active: boolean
  description: string
  icon: typeof Monitor
  onSelect: () => void
  title: string
}) {
  return (
    <button
      className={cn(
        'rounded-xl border p-4 text-left transition',
        active
          ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/20'
          : 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) hover:bg-(--chrome-action-hover)'
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" />
        <span>{title}</span>
        {active ? <Check className="ml-auto size-4 text-primary" /> : null}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p>
    </button>
  )
}

export function DesktopConnectionSetupOverlay() {
  const [ready, setReady] = useState(false)
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [view, setView] = useState<View>('choose')
  const [mode, setMode] = useState<'local' | 'remote'>('local')

  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<DesktopConnectionTestResult | null>(null)
  const [error, setError] = useState<null | string>(null)

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const desktop = window.hermesDesktop

    if (!desktop?.needsBootstrapSetup || !desktop?.getConnectionConfig) {
      return
    }

    void Promise.all([desktop.needsBootstrapSetup(), desktop.getConnectionConfig(null)]).then(
      ([{ needed }, config]) => {
        if (!mountedRef.current) return
        setReady(true)

        if (needed && config.mode !== 'remote') {
          setShow(true)
        }
      }
    )
  }, [])

  if (!ready || !show || dismissed) {
    return null
  }

  const handleTestConnection = async () => {
    if (!url.trim()) return
    setTesting(true)
    setError(null)
    setTestResult(null)

    try {
      const result = await window.hermesDesktop.testConnectionConfig({
        mode: 'remote',
        remoteUrl: url.trim(),
        remoteAuthMode: 'token',
        remoteToken: token.trim() || undefined
      })
      if (mountedRef.current) setTestResult(result)
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Connection test failed.')
    } finally {
      if (mountedRef.current) setTesting(false)
    }
  }

  const handleConnect = async () => {
    if (!url.trim() || !token.trim()) return
    setSaving(true)
    setError(null)

    try {
      await window.hermesDesktop.saveConnectionConfig({
        mode: 'remote',
        remoteUrl: url.trim(),
        remoteAuthMode: 'token',
        remoteToken: token.trim()
      })
      window.location.reload()
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not save connection config.')
        setSaving(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-(--ui-chat-surface-background) p-6">
      <div className="relative w-full max-w-[42rem] overflow-hidden rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) shadow-sm">
        {/* Header */}
        <div className="border-b border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-tight">Connect to Hermes Agent</h2>
              <p className="mt-1 max-w-xl text-[0.8125rem] leading-5 text-(--ui-text-tertiary)">
                Run Hermes locally on this machine, or connect to an existing remote instance.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="grid gap-3 p-5">
          {view === 'choose' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <ModeCard
                  active={mode === 'local'}
                  description="Install and run Hermes on this machine. Recommended for first-time setup."
                  icon={Monitor}
                  onSelect={() => setMode('local')}
                  title="Local"
                />
                <ModeCard
                  active={mode === 'remote'}
                  description="Connect to a Hermes instance running on a server, VPS, or cloud machine."
                  icon={Globe}
                  onSelect={() => setMode('remote')}
                  title="Remote"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-(--ui-stroke-tertiary) pt-3">
                {mode === 'local' ? (
                  <Button onClick={() => setDismissed(true)}>Continue with local install</Button>
                ) : (
                  <Button onClick={() => setView('remote')}>Configure remote connection</Button>
                )}
              </div>
            </>
          )}

          {view === 'remote' && (
            <>
              <button
                className="-mt-1 mb-1 flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setView('choose')
                  setError(null)
                  setTestResult(null)
                }}
                type="button"
              >
                ← Back
              </button>

              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-url">
                    Remote URL
                  </label>
                  <Input
                    autoFocus
                    id="remote-url"
                    onChange={e => {
                      setUrl(e.target.value)
                      setTestResult(null)
                      setError(null)
                    }}
                    placeholder="https://your-server.example.com"
                    type="url"
                    value={url}
                  />
                </div>

                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-token">
                    Session token
                  </label>
                  <Input
                    id="remote-token"
                    onChange={e => {
                      setToken(e.target.value)
                      setTestResult(null)
                      setError(null)
                    }}
                    onKeyDown={e => e.key === 'Enter' && void handleConnect()}
                    placeholder="Paste your Hermes session token"
                    type="password"
                    value={token}
                  />
                  <p className="text-xs text-muted-foreground">
                    Find this in Settings → Gateway on the remote Hermes instance.
                  </p>
                </div>

                {testResult && (
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                      testResult.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                    )}
                  >
                    {testResult.ok ? (
                      <>
                        <Check className="size-4 shrink-0" />
                        <span>
                          Connected{testResult.version ? ` · Hermes ${testResult.version}` : ''}
                        </span>
                      </>
                    ) : (
                      <span>Could not connect — check URL and token.</span>
                    )}
                  </div>
                )}

                {error && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) pt-3">
                <Button
                  disabled={!url.trim() || testing || saving}
                  onClick={() => void handleTestConnection()}
                  variant="outline"
                >
                  {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                  {testing ? 'Testing...' : 'Test connection'}
                </Button>
                <Button
                  disabled={!url.trim() || !token.trim() || saving}
                  onClick={() => void handleConnect()}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
