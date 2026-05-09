import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TrackedRange } from '../../../core/models/vision.model';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VisionService } from '../../../core/services/vision.service';
import {
  DetectedObject,
  VisionPanelState,
  VisionSession,
} from '../../../core/models/vision.model';
import { NotificationService } from '../../../core/services/notification.service';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-vision-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './vision-panel.component.html',
  styleUrl: './vision-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisionPanelComponent implements OnInit {
  projectId = input.required<string>();
  clipId = input.required<string>();
  mediaPath = input.required<string>();
  currentTime = input<number>(0);

  objectsChange = output<DetectedObject[]>();
  trackedRangeChange = output<TrackedRange | null>();

  private visionService = inject(VisionService);
  private notifications = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef);

  readonly panelState = signal<VisionPanelState>('idle');
  readonly objects = signal<DetectedObject[]>([]);
  readonly trackProgress = signal(0);
  readonly trackFrames = signal<{ processed: number; total: number } | null>(null);
  readonly trackWarning = signal<string | null>(null);
  readonly trackedRange = signal<TrackedRange | null>(null);
  readonly exportProgress = signal(0);
  readonly previewUrl = signal<string | null>(null);
  readonly exportId = signal<string | null>(null);
  readonly maskSessionId = signal<string | null>(null);
  readonly noObjectsMessage = signal<string | null>(null);
  readonly inpaintFallback = signal(false);

  readonly enabledObjects = computed(() => this.objects().filter((o) => o.maskEnabled));
  readonly downloadUrl = computed(() => {
    const eid = this.exportId();
    return eid ? this.visionService.getDownloadUrl(this.projectId(), eid) : null;
  });

  async ngOnInit(): Promise<void> {
    const alive = await this.visionService.checkHealth();
    if (!alive) {
      this.panelState.set('offline');
    }
  }

  async detect(): Promise<void> {
    this.trackedRange.set(null);
    this.trackFrames.set(null);
    this.trackWarning.set(null);
    this.noObjectsMessage.set(null);
    this.inpaintFallback.set(false);
    this.trackedRangeChange.emit(null);
    this.panelState.set('detecting');
    try {
      const detected = await this.visionService.detect(
        this.mediaPath(),
        this.currentTime()
      );
      this.objects.set(detected);
      this.objectsChange.emit(detected);
      if (detected.length === 0) {
        this.noObjectsMessage.set('No objects detected — try a different frame');
        this.panelState.set('idle');
      } else {
        this.panelState.set('detected');
      }
    } catch (err) {
      this.panelState.set('idle');
      this.notifications.add({ message: `Detection failed: ${err}`, level: 'error' });
    }
  }

  toggleObject(objId: string): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, maskEnabled: !o.maskEnabled } : o))
    );
    this.objectsChange.emit(this.objects());
  }

  setEffect(objId: string, effect: 'blur' | 'inpaint' | 'fill'): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, effect } : o))
    );
  }

  setFillColor(objId: string, color: string): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, fillColor: color } : o))
    );
  }

  async applyMask(): Promise<void> {
    const sessionId = uuidv4();
    this.maskSessionId.set(sessionId);
    this.panelState.set('tracking');
    this.trackProgress.set(0);

    const enabledObjs = this.enabledObjects();
    const trackObjects = enabledObjs.map((o) => ({ id: o.id, bbox: o.bbox }));

    try {
      for await (const event of this.visionService.track(
        this.mediaPath(),
        this.currentTime(),
        trackObjects,
        sessionId,
        this.projectId()
      )) {
        if (event.type === 'progress') {
          this.trackProgress.set(event.percent ?? 0);
          if (event.framesProcessed !== undefined && event.totalFrames !== undefined) {
            this.trackFrames.set({ processed: event.framesProcessed, total: event.totalFrames });
          }
          this.cdr.markForCheck();
        } else if (event.type === 'warning') {
          this.trackWarning.set(event.message ?? null);
          this.cdr.markForCheck();
        } else if (event.type === 'complete') {
          if (event.firstFrameIdx !== undefined && event.lastFrameIdx !== undefined && event.fps) {
            const range: TrackedRange = {
              startSec: event.firstFrameIdx / event.fps,
              endSec: event.lastFrameIdx / event.fps,
            };
            this.trackedRange.set(range);
            this.trackedRangeChange.emit(range);
          }
          await this.loadPreview();
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      this.panelState.set('detected');
      this.notifications.add({ message: `Tracking failed: ${err}`, level: 'error' });
    }
  }

  async loadPreview(): Promise<void> {
    const sid = this.maskSessionId();
    if (!sid) return;
    try {
      const { url, usedInpaintFallback } = await this.visionService.preview(
        this.mediaPath(),
        this.currentTime(),
        sid,
        this.projectId(),
        this.enabledObjects()
      );
      this.previewUrl.set(url);
      this.inpaintFallback.set(usedInpaintFallback);
      this.panelState.set('preview');
    } catch (err) {
      this.notifications.add({ message: `Preview failed: ${err}`, level: 'error' });
    }
  }

  async exportWithMasks(): Promise<void> {
    const sid = this.maskSessionId();
    if (!sid) return;

    const eid = uuidv4();
    this.exportId.set(eid);
    this.panelState.set('exporting');
    this.exportProgress.set(0);

    try {
      for await (const event of this.visionService.exportMasked(
        this.mediaPath(),
        sid,
        this.projectId(),
        eid,
        this.enabledObjects()
      )) {
        if (event.type === 'progress') {
          this.exportProgress.set(event.percent ?? 0);
          this.cdr.markForCheck();
        } else if (event.type === 'complete') {
          this.panelState.set('export-done');
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      this.panelState.set('preview');
      this.notifications.add({ message: `Export failed: ${err}`, level: 'error' });
    }
  }
}
