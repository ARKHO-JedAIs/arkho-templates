import { useCallback, useEffect, useState } from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  adoptConsoleVersion,
  fetchVersion,
  fetchVersions,
  rollbackTo,
} from '../agentConfigService';
import { formatDate } from '../format';
import type { AgentVersion, AgentVersionSummary, ConsoleVersion } from '../types';

interface VersionHistoryProps {
  /** The version the agent uses now. */
  current: string;
  /** A version was restored: the page reloads its state. */
  onRestored: () => Promise<void> | void;
  onError: (error: unknown, fallback: string) => void;
}

/** Every published version, newest first; any can be viewed or restored as a new version. */
export function VersionHistory({ current, onRestored, onError }: VersionHistoryProps) {
  const [versions, setVersions] = useState<AgentVersionSummary[] | null>(null);
  const [consoleVersions, setConsoleVersions] = useState<ConsoleVersion[]>([]);
  const [adopting, setAdopting] = useState<ConsoleVersion | null>(null);
  const [viewing, setViewing] = useState<AgentVersion | null>(null);
  const [restoring, setRestoring] = useState<AgentVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchVersions();
      setVersions(data.versions);
      setConsoleVersions(data.consoleVersions);
    } catch (err) {
      onError(err, 'No se pudo cargar el historial');
      setVersions([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleView = async (version: string) => {
    try {
      setViewing(await fetchVersion(version));
    } catch (err) {
      onError(err, 'No se pudo cargar la versión');
    }
  };

  const handleRestore = async () => {
    if (!restoring) return;
    setBusy(true);
    try {
      const created = await rollbackTo(restoring.version, `Vuelve a ${restoring.version}`);
      toast.success(
        `${restoring.version} activada (queda como ${created.version}). El agente la usa en menos de un minuto.`
      );
      setRestoring(null);
      await load();
      await onRestored();
    } catch (err) {
      onError(err, 'No se pudo activar la versión');
    } finally {
      setBusy(false);
    }
  };

  const handleAdopt = async () => {
    if (!adopting) return;
    setBusy(true);
    try {
      const created = await adoptConsoleVersion(adopting.bedrockVersion);
      toast.success(`En uso como ${created.version}. El agente la usa en menos de un minuto.`);
      setAdopting(null);
      await load();
      await onRestored();
    } catch (err) {
      onError(err, 'No se pudo usar la versión');
    } finally {
      setBusy(false);
    }
  };

  const consoleSection = consoleVersions.length > 0 && (
    <div className='flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4'>
      <p className='text-sm font-medium text-foreground'>Versiones creadas en la consola de AWS</p>
      <p className='text-xs text-muted-foreground'>
        Existen en Bedrock Prompt Management pero el agente no las usa. Al usarlas quedan en este
        historial con tu nombre.
      </p>
      {consoleVersions.map(item => (
        <div
          key={item.bedrockVersion}
          className='flex flex-wrap items-center justify-between gap-2 text-sm'
        >
          <span>
            Bedrock v{item.bedrockVersion} · {formatDate(item.createdAt)}
            {item.description ? ` · ${item.description}` : ''}
          </span>
          <Button variant='outline' size='sm' onClick={() => setAdopting(item)}>
            Usar esta versión
          </Button>
        </div>
      ))}
    </div>
  );

  const adoptDialog = (
    <AlertDialog open={adopting !== null} onOpenChange={open => !open && setAdopting(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Usar la versión {adopting?.bedrockVersion} de Bedrock?
          </AlertDialogTitle>
          <AlertDialogDescription>
            El agente usará sus instrucciones y su modelo en menos de un minuto. Los mensajes, el
            interruptor y los parámetros siguen como están.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void handleAdopt()} disabled={busy}>
            Usar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (versions === null) {
    return <div className='h-40 rounded-xl bg-muted animate-pulse' />;
  }

  if (versions.length === 0) {
    return (
      <>
        {consoleSection}
        <p className='text-sm text-muted-foreground py-4'>
          Todavía no hay versiones publicadas desde la web. El agente usa la configuración del
          despliegue (v0000); la primera publicación será la v0001.
        </p>
        {adoptDialog}
      </>
    );
  }

  return (
    <>
      {consoleSection}
      {adoptDialog}
      <div className='rounded-xl border border-border bg-card overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Versión</TableHead>
              <TableHead>Bedrock</TableHead>
              <TableHead>Publicada</TableHead>
              <TableHead>Por</TableHead>
              <TableHead>Comentario</TableHead>
              <TableHead className='text-right'>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map(item => (
              <TableRow key={item.version}>
                <TableCell className='font-medium'>
                  <span className='flex items-center gap-2'>
                    {item.version}
                    {item.version === current && (
                      <Badge
                        variant='outline'
                        className='border-transparent bg-primary text-primary-foreground'
                      >
                        En uso
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {item.bedrockVersion ? `v${item.bedrockVersion}` : '—'}
                  {item.source === 'console' ? ' (consola)' : ''}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDate(item.publishedAt)}
                </TableCell>
                <TableCell className='text-muted-foreground'>{item.publishedBy || '—'}</TableCell>
                <TableCell className='text-muted-foreground'>
                  {item.comment || (item.rollbackOf ? `Vuelve a ${item.rollbackOf}` : '—')}
                </TableCell>
                <TableCell>
                  <div className='flex items-center justify-end gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      title='Ver'
                      onClick={() => void handleView(item.version)}
                    >
                      <Eye className='h-4 w-4' />
                    </Button>
                    {item.version !== current && (
                      <Button variant='outline' size='sm' onClick={() => setRestoring(item)}>
                        <RotateCcw className='mr-1.5 h-3.5 w-3.5' aria-hidden />
                        Activar
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={viewing !== null} onOpenChange={open => !open && setViewing(null)}>
        <DialogContent className='max-w-3xl'>
          <DialogHeader>
            <DialogTitle>
              {viewing?.version} · {formatDate(viewing?.publishedAt)}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className='flex max-h-[65vh] flex-col gap-3 overflow-y-auto text-sm'>
              <p>
                <span className='font-medium'>Agente:</span>{' '}
                {viewing.config.enabled ? 'activo' : 'apagado'} ·{' '}
                <span className='font-medium'>Negocio:</span> {viewing.config.businessName}
              </p>
              <p>
                <span className='font-medium'>Modelo:</span> {viewing.config.model.id} · temperatura{' '}
                {viewing.config.model.temperature} · máx. {viewing.config.model.maxTokens} tokens
                {viewing.bedrockVersion ? ` · Bedrock v${viewing.bedrockVersion}` : ''}
              </p>
              {Object.keys(viewing.config.parameters).length > 0 && (
                <p>
                  <span className='font-medium'>Parámetros:</span>{' '}
                  {Object.entries(viewing.config.parameters)
                    .map(([name, value]) => `{{${name}}} = ${value}`)
                    .join(' · ')}
                </p>
              )}
              <div>
                <p className='font-medium mb-1'>Instrucciones</p>
                <pre className='whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs'>
                  {viewing.config.instructions}
                </pre>
              </div>
              <p>
                <span className='font-medium'>Saludo:</span> {viewing.config.greeting}
              </p>
              <p>
                <span className='font-medium'>Fuera de tema:</span> {viewing.config.refusal}
              </p>
              <p>
                <span className='font-medium'>Derivación:</span> {viewing.config.handoffMessage}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={restoring !== null} onOpenChange={open => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Activar la {restoring?.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              El agente vuelve a usar sus instrucciones, mensajes y modelo en menos de un minuto.
              Queda registrado en el historial con tu nombre y no se borra nada: puedes volver a la
              versión actual ({current}) cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRestore()} disabled={busy}>
              Activar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
