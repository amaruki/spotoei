// Sidebar navigation entries. Locked-down entries (🔒) are shown when
// the user is unauthenticated so they still see the route shape but
// understand nothing will load until they sign in.
export function getNavOptions(isAuthenticated: boolean) {
  if (!isAuthenticated) {
    return [
      { name: '🔒 Home', description: 'Requires login', value: 'home' },
      { name: '🔒 Search', description: 'Requires login', value: 'search' },
      { name: '🔒 Library', description: 'Requires login', value: 'library' },
      { name: '🔒 Queue', description: 'Requires login', value: 'queue' },
      { name: '⚙ Settings', description: 'Setup & Auth', value: 'settings' },
    ];
  }
  return [
    { name: 'Home', description: 'Now playing', value: 'home' },
    { name: 'Search', description: 'Find music', value: 'search' },
    { name: 'Library', description: 'Saved tracks', value: 'library' },
    { name: 'Queue', description: 'Upcoming', value: 'queue' },
    { name: 'Settings', description: 'Auth & info', value: 'settings' },
  ];
}
