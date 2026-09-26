export const places = [
  { id: 'engineering', name: 'Engineering Core', type: 'Building', detail: 'Accessible entrance', icon: '⌂', x: 310, y: 300, accessible: true },
  { id: 'checkin', name: 'Open Day check-in', type: 'Event location', detail: 'North Quad', icon: '✳', x: 140, y: 190, accessible: true },
  { id: 'library', name: 'Puaka–James Hight Library', type: 'Library', detail: 'Lift available', icon: '▤', x: 570, y: 190, accessible: true },
  { id: 'rec', name: 'Recreation Centre', type: 'Building', detail: 'Step-free access', icon: '⌂', x: 600, y: 340, accessible: true },
  { id: 'bathroom', name: 'Accessible bathroom', type: 'Bathroom', detail: 'Ernest Rutherford Building', icon: '♿', x: 430, y: 270, accessible: true },
  { id: 'north', name: 'North entrance', type: 'Entrance', detail: 'Open · step-free', icon: '↗', x: 140, y: 190, accessible: true },
  { id: 'science', name: 'Rutherford Regional Science', type: 'Building', detail: 'Lifts available', icon: '⌂', x: 430, y: 125, accessible: true },
  { id: 'gardens', name: 'Ilam Gardens', type: 'Outdoor space', detail: 'Pedestrian paths', icon: '❋', x: 760, y: 400, accessible: true },
];

export const buildings = [
  { x: 180, y: 145, w: 140, h: 84, name: 'Puaka–James Hight' },
  { x: 365, y: 82, w: 134, h: 88, name: 'Rutherford Regional Science' },
  { x: 535, y: 146, w: 145, h: 88, name: 'Library' },
  { x: 316, y: 250, w: 152, h: 92, name: 'Engineering Core' },
  { x: 510, y: 302, w: 156, h: 90, name: 'Recreation Centre' },
  { x: 180, y: 294, w: 100, h: 72, name: 'The Foundry' },
  { x: 390, y: 412, w: 145, h: 80, name: 'Ilam Apartments' },
];

export const hourlyActivity = [24, 38, 50, 68, 84, 95, 80, 64, 52, 42, 31, 23];

export const destinationActivity = [
  { name: 'Engineering Core', count: 612, share: 91 },
  { name: 'Open Day check-in', count: 498, share: 76 },
  { name: 'Library', count: 397, share: 61 },
  { name: 'Recreation Centre', count: 291, share: 45 },
  { name: 'Ilam Gardens', count: 188, share: 30 },
];
