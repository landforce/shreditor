/** The shell listens for this and focuses the media bin (replace a clip by dragging from it). */
export const FOCUS_MEDIA_BIN_EVENT = 'shreditor:focus-media-bin'

/**
 * The editor shell listens for this and saves the project (the shell owns the
 * save routine; there is no shared callback to call from here).
 */
export const SAVE_PROJECT_EVENT = 'shreditor:save-project'
