import { MediaPlayerService } from './media-player.service';

describe('MediaPlayerService', () => {
  it('syncs currentTime and duration from attached media', () => {
    const service = new MediaPlayerService();
    const media = document.createElement('audio');

    Object.defineProperty(media, 'duration', { value: 120, configurable: true });
    media.currentTime = 30;

    service.attachElement(media);
    media.dispatchEvent(new Event('timeupdate'));

    expect(service.currentTime()).toBe(30);
    expect(service.duration()).toBe(120);
    service.detachElement();
  });

  it('clamps seek, volume, and playback rate', () => {
    const service = new MediaPlayerService();
    const media = document.createElement('audio');

    Object.defineProperty(media, 'duration', { value: 60, configurable: true });
    service.attachElement(media);

    service.seek(999);
    service.setVolume(2);
    service.setRate(0.1);

    expect(service.currentTime()).toBe(60);
    expect(service.volume()).toBe(1);
    expect(service.playbackRate()).toBe(0.5);

    service.detachElement();
  });
});
