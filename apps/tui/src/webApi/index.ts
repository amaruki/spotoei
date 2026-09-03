// Public surface for the Web API client. Composes a Transport plus the
// endpoint groups behind a single WebApiClient class so callers can keep
// the existing one-class API stable.

import { CatalogEndpoints } from './catalog';
import { EntityEndpoints } from './entityEndpoints';
import { LibraryEndpoints } from './library';
import { PlayerEndpoints } from './player';
import { QueueEndpoints } from './queue';
import { Transport } from './transport';
import type { WebApiClientOptions } from './types';

export type { TokenProvider, WebApiClientOptions } from './types';

export class WebApiClient {
  private transport: Transport;
  private catalog: CatalogEndpoints;
  private entities: EntityEndpoints;
  private library: LibraryEndpoints;
  private queue: QueueEndpoints;
  private player: PlayerEndpoints;

  constructor(opts: WebApiClientOptions) {
    this.transport = new Transport(opts.tokenProvider, opts.baseUrl);
    this.catalog = new CatalogEndpoints(this.transport);
    this.entities = new EntityEndpoints(this.transport);
    this.library = new LibraryEndpoints(this.transport);
    this.queue = new QueueEndpoints(this.transport);
    this.player = new PlayerEndpoints(this.transport);
  }

  // --- Catalog / Search ---
  search: CatalogEndpoints['search'] = (...args) => this.catalog.search(...args);
  getTrackView: CatalogEndpoints['getTrackView'] = (id) => this.catalog.getTrackView(id);
  getAlbumView: CatalogEndpoints['getAlbumView'] = (id) => this.catalog.getAlbumView(id);
  getRecommendations: CatalogEndpoints['getRecommendations'] = (opts) =>
    this.catalog.getRecommendations(opts);
  // --- Entity Details & Personalization ---
  getArtistView: EntityEndpoints['getArtistView'] = (id) => this.entities.getArtistView(id);
  getArtistAlbums: EntityEndpoints['getArtistAlbums'] = (...args) =>
    this.entities.getArtistAlbums(...args);
  getAlbumTracks: EntityEndpoints['getAlbumTracks'] = (...args) =>
    this.entities.getAlbumTracks(...args);
  getPlaylistView: EntityEndpoints['getPlaylistView'] = (id) => this.entities.getPlaylistView(id);
  getPlaylistTracks: EntityEndpoints['getPlaylistTracks'] = (...args) =>
    this.entities.getPlaylistTracks(...args);
  getUserTopTracks: EntityEndpoints['getUserTopTracks'] = (...args) =>
    this.entities.getUserTopTracks(...args);
  getUserTopArtists: EntityEndpoints['getUserTopArtists'] = (...args) =>
    this.entities.getUserTopArtists(...args);
  getRecentlyPlayed: EntityEndpoints['getRecentlyPlayed'] = (...args) =>
    this.entities.getRecentlyPlayed(...args);

  // --- Library ---
  getLibraryPage: LibraryEndpoints['getLibraryPage'] = (...args) =>
    this.library.getLibraryPage(...args);
  checkMembership: LibraryEndpoints['checkMembership'] = (uris) =>
    this.library.checkMembership(uris);
  saveUris: LibraryEndpoints['saveUris'] = (uris) => this.library.saveUris(uris);
  removeUris: LibraryEndpoints['removeUris'] = (uris) => this.library.removeUris(uris);
  saveItem: LibraryEndpoints['saveItem'] = (...args) => this.library.saveItem(...args);
  removeItem: LibraryEndpoints['removeItem'] = (...args) => this.library.removeItem(...args);

  // --- Queue ---
  addToQueue: QueueEndpoints['addToQueue'] = (uri) => this.queue.addToQueue(uri);
  getQueueSnapshot: QueueEndpoints['getQueueSnapshot'] = () => this.queue.getQueueSnapshot();

  // --- Playback / Connect ---
  play: PlayerEndpoints['play'] = (opts) => this.player.play(opts);
  pause: PlayerEndpoints['pause'] = () => this.player.pause();
  nextTrack: PlayerEndpoints['nextTrack'] = () => this.player.nextTrack();
  previousTrack: PlayerEndpoints['previousTrack'] = () => this.player.previousTrack();
  seek: PlayerEndpoints['seek'] = (ms) => this.player.seek(ms);
  setVolume: PlayerEndpoints['setVolume'] = (vol) => this.player.setVolume(vol);
  shuffle: PlayerEndpoints['shuffle'] = (state) => this.player.shuffle(state);
  repeat: PlayerEndpoints['repeat'] = (state) => this.player.repeat(state);
  getPlaybackState: PlayerEndpoints['getPlaybackState'] = () => this.player.getPlaybackState();
  getDevices: PlayerEndpoints['getDevices'] = () => this.player.getDevices();
  transferPlayback: PlayerEndpoints['transferPlayback'] = (id, play) =>
    this.player.transferPlayback(id, play);
  getArtistGenres: PlayerEndpoints['getArtistGenres'] = (id) => this.player.getArtistGenres(id);
}
