/* config.js — EDIT ME
 * Everything a trainer is likely to change lives here.
 * Nothing is saved: a page reload always gives a brand-new account.
 */
window.CONFIG = {
  user: { name: 'Learner', email: 'learner@practice.drive', initial: 'L', color: '#7b1fa2' },
  quotaGB: 15,
  startPage: 'home',            // or 'my-drive'
  showPracticeGuide: true,      // also switchable per link with ?guide=off
  uploadSpeedMs: 1400,          // roughly how long one simulated upload takes
  trashRetentionDays: 30,

  // Items that appear under "Shared with me". Example:
  // { name: 'Orientation Handbook.pdf', type: 'pdf', owner: 'Training Office', size: 482133 }
  seedSharedWithMe: [],

  // Leave empty for a true first-day account. Folders can nest:
  // { name: 'Projects', children: [ { name: 'Budget.xlsx', size: 20480 } ] }
  seedMyDrive: []
};
