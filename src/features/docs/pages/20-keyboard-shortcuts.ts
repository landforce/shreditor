import type { DocPageContent } from '../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Keyboard Shortcuts',
  description: 'Default shortcuts by group, plus how to search, rebind, and reset them.',
  category: 'Reference',
  sections: [
    {
      title: 'Playback',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Play / Pause', '`Space`'],
            ['Previous / Next frame', '`Left` / `Right`'],
            ['Previous / Next snap point', '`Up` / `Down`'],
            ['Go to start / end', '`Home` / `End`'],
            ['Shuttle reverse / pause / forward', '`J` / `K` / `L`'],
            ['Step one frame back / forward', 'Hold `K`, press `J` / `L`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Press `J` or `L` again to shuttle faster (2x, then 4x). `K` pauses only while playing; when paused it adds a keyframe to the selected Edit layer.',
        },
      ],
    },
    {
      title: 'Selection',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Select all clips', '`Ctrl+A`'],
            ['Deselect all', '`Ctrl+Shift+A` / `Esc`'],
            ['Select clip at playhead', '`D`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Select all skips locked tracks. In a text field `Ctrl+A` still selects the text. `D` picks the clip on the active track, or the topmost one under the playhead.',
        },
      ],
    },
    {
      title: 'Editing',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Add edit at playhead (selected clips, else every unlocked clip)', '`Ctrl+K`'],
            ['Split every clip at playhead', '`Alt+C`'],
            ['Ripple trim clip start / end to playhead', '`Q` / `W`'],
            ['Duplicate selected clips', '`Ctrl+D`'],
            ['Split at cursor', '`Shift+C`'],
            ['Join', '`Shift+J`'],
            ['Delete / Ripple delete', '`Delete` / `Ctrl+Delete`'],
            ['Insert freeze frame', '`Shift+F`'],
            ['Link / Unlink clips', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Toggle linked selection', '`Shift+L`'],
            ['Nudge 1px / 10px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Tools',
      blocks: [
        {
          kind: 'table',
          headers: ['Tool', 'Shortcut'],
          rows: [
            ['Selection', '`V`'],
            ['Trim edit', '`T`'],
            ['Razor', '`C`'],
            ['Rate stretch', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple and rolling are trim behaviors of the **Trim edit** tool, not separate tools with their own shortcut.',
        },
      ],
    },
    {
      title: 'History, view, and clipboard',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Undo / Redo', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copy / Cut / Paste', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Toggle snap / canvas snap', '`S` / `Shift+S`'],
            ['Zoom in / out', '`Ctrl+=` / `Ctrl+-`'],
            ['Zoom to fit / 100%', '`\\` / `Shift+\\`'],
            ['Edit / Color / Motion workspace', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Markers and keyframes',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Add / Remove marker', '`M` / `Shift+M`'],
            ['Previous / Next marker', '`[` / `]`'],
            ['Clear keyframes', '`Shift+A`'],
            ['Add keyframe to selected Edit layer', '`K`'],
            ['Keyframe graph / sheet / split view', '`1` / `2` / `3`'],
            ['Previous / Next property keyframe', '`Alt+[` / `Alt+]`'],
            ['Toggle auto-key for active property', '`A`'],
            ['Fit selected keyframes', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Source monitor and project',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Mark In / Out', '`I` / `O`'],
            ['Clear In/Out', '`Alt+X`'],
            ['Insert / Overwrite edit', '`,` / `.`'],
            ['Save', '`Ctrl+S`'],
            ['Export', '`Ctrl+Shift+E`'],
            ['Open Scene Browser', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Customize shortcuts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every binding above is a shipped default. Open the redesigned shortcut editor from the **Keyboard Shortcuts** button (keyboard icon) in the editor toolbar to remap any command to the keys you prefer.',
        },
        {
          kind: 'steps',
          items: [
            'Search commands by name, or filter to the **Custom**, **Conflicts**, or **Unassigned** groups.',
            'Pick a command and press **Record**, then hold your modifiers and press the final key.',
            'If the combo is already in use, the editor flags the conflict — choose **Overwrite** to reassign it, or pick different keys.',
            'Use **Unbind** to clear a binding, or add an alternate binding alongside the primary one.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use **Reset** to restore a single command, or **Reset All** to return every shortcut to its default. You can also **Export** your bindings to a preset file and **Import** it on another machine.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
