// Sidebar navigation entries. Locked-down entries (🔒) are shown when
// the user is unauthenticated so they still see the route shape but
// understand nothing will load until they sign in.
export function getStatusBadge(isPrivateSession: boolean): string {
  return isPrivateSession ? '🕶 [Private]' : '';
}

export function getNavOptions(isAuthenticated: boolean, isPrivateSession: boolean = false) {
  const privateSuffix = isPrivateSession ? ' 🕶' : '';
  if (!isAuthenticated) {
    return [
      { name: '🔒 Home', description: 'Requires login', value: 'home' },
      { name: '🔒 Browse', description: 'Requires login', value: 'browse' },
      { name: '🔒 Search', description: 'Requires login', value: 'search' },
      { name: '🔒 Library', description: 'Requires login', value: 'library' },
      { name: '🔒 Queue', description: 'Requires login', value: 'queue' },
      {
        name: `⚙ Settings${privateSuffix}`,
        description: isPrivateSession ? 'Private Session active' : 'Setup',
        value: 'settings',
      },
    ];
  }
  return [
    { name: 'Home', description: 'For you', value: 'home' },
    { name: 'Browse', description: 'Discover', value: 'browse' },
    { name: 'Search', description: 'Find music', value: 'search' },
    { name: 'Library', description: 'Saved tracks', value: 'library' },
    { name: 'Queue', description: 'Upcoming', value: 'queue' },
    {
      name: `Settings${privateSuffix}`,
      description: isPrivateSession ? 'Private Session active' : 'App info',
      value: 'settings',
    },
    { name: 'Account', description: 'Login & auth status', value: 'onboarding' },
  ];
}
