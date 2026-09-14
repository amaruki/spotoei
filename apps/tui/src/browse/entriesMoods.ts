// Static mood and activity browse entries.

import type { BrowseEntryT } from 'spotoei-protocol';

export const MOODS_ENTRIES: BrowseEntryT[] = [
  {
    id: 'chill',
    label: 'Chill',
    description: 'Relaxed and calm vibes',
    enabled: true,
    source: { kind: 'search', query: 'chill', types: ['playlist', 'track'] },
  },
  {
    id: 'focus',
    label: 'Focus',
    description: 'Music for deep concentration',
    enabled: true,
    source: { kind: 'search', query: 'focus study', types: ['playlist'] },
  },
  {
    id: 'sleep',
    label: 'Sleep',
    description: 'Gentle ambient sounds for sleep',
    enabled: true,
    source: { kind: 'search', query: 'sleep ambient', types: ['playlist'] },
  },
  {
    id: 'happy',
    label: 'Happy & Upbeat',
    description: 'Feel-good mood boosters',
    enabled: true,
    source: { kind: 'search', query: 'happy feel good', types: ['playlist'] },
  },
  {
    id: 'party',
    label: 'Party',
    description: 'High energy dance and party',
    enabled: true,
    source: { kind: 'search', query: 'party dance', types: ['playlist'] },
  },
  {
    id: 'relax',
    label: 'Relax',
    description: 'Unwind and decompress',
    enabled: true,
    source: { kind: 'search', query: 'relax calm', types: ['playlist', 'track'] },
  },
  {
    id: 'romance',
    label: 'Romance',
    description: 'Intimate and romantic melodies',
    enabled: true,
    source: { kind: 'search', query: 'romance love', types: ['playlist'] },
  },
  {
    id: 'sad',
    label: 'Sad & Melancholy',
    description: 'Emotional and reflective songs',
    enabled: true,
    source: { kind: 'search', query: 'sad melancholic', types: ['playlist', 'track'] },
  },
  {
    id: 'ambient',
    label: 'Ambient',
    description: 'Atmospheric soundscapes',
    enabled: true,
    source: { kind: 'search', query: 'ambient atmospheric', types: ['playlist'] },
  },
  {
    id: 'energy',
    label: 'High Energy',
    description: 'Fast and motivational tracks',
    enabled: true,
    source: { kind: 'search', query: 'high energy', types: ['playlist', 'track'] },
  },
];

export const ACTIVITIES_ENTRIES: BrowseEntryT[] = [
  {
    id: 'workout',
    label: 'Workout',
    description: 'High-BPM energy music',
    enabled: true,
    source: { kind: 'search', query: 'workout gym', types: ['playlist'] },
  },
  {
    id: 'running',
    label: 'Running',
    description: 'Steady cadence beats',
    enabled: true,
    source: { kind: 'search', query: 'running tempo', types: ['playlist'] },
  },
  {
    id: 'gaming',
    label: 'Gaming',
    description: 'Electronic and synthwave gaming tracks',
    enabled: true,
    source: { kind: 'search', query: 'gaming electronic synthwave', types: ['playlist'] },
  },
  {
    id: 'study',
    label: 'Study',
    description: 'Lo-fi and classical study tunes',
    enabled: true,
    source: { kind: 'search', query: 'lofi study beats', types: ['playlist'] },
  },
  {
    id: 'cooking',
    label: 'Cooking & Dinner',
    description: 'Acoustic and jazz background tunes',
    enabled: true,
    source: { kind: 'search', query: 'dinner jazz acoustic', types: ['playlist'] },
  },
  {
    id: 'meditation',
    label: 'Meditation',
    description: 'Mindful breathing and peace',
    enabled: true,
    source: { kind: 'search', query: 'meditation mindfulness', types: ['playlist'] },
  },
  {
    id: 'reading',
    label: 'Reading',
    description: 'Quiet acoustic background',
    enabled: true,
    source: { kind: 'search', query: 'reading acoustic quiet', types: ['playlist'] },
  },
  {
    id: 'travel',
    label: 'Travel & Commute',
    description: 'Soundtracks for the journey',
    enabled: true,
    source: { kind: 'search', query: 'road trip travel', types: ['playlist'] },
  },
];
