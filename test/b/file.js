import { PackCompletionMode } from "./levelLoader/levelLoader.js";

/**
 * Play modes for the level editor
 */
export const PlayMode = {
  PLAY_LEVEL: "play", // Play current level only
  PLAY_PROJECT_HERE: "play-project-here", // Play project starting from current level
  PLAY_PROJECT_START: "play-project-start", // Play project from first level
};

/**
 * Play System class
 * Handles play tools interaction, validation, and project persistence
 */
export class PlaySystem {
  constructor() {
    // No longer using localStorage for project persistence
  }

  /**
   * Initialize the play system
   * @param {Object} options - Configuration options
   */
  init(options = {}) {
    // Try to restore last opened project
    this.tryRestoreLastProject();
  }

  /**
   * Handle play action from toolbar
   * @param {string} playMode - The play mode (PlayMode enum)
   * @returns {boolean} Success status
   */
  async handlePlay(playMode) {
    console.log(`[PlaySystem] Handling play action: ${playMode}`);

    // Check if we have a project loaded
    const projectManager = globalThis._editorScope?.projectManager;
    if (!projectManager || !projectManager.hasProjectLoaded()) {
      console.error("[PlaySystem] No project loaded");
      this.showError(
        "No project is currently loaded. Please create or open a project first."
      );
      return false;
    }

    // Validate the level first
    if (!this.validateLevel(playMode)) {
      // Validation failed, dialog will be shown automatically
      return false;
    }

    // Save project before playing
    if (!(await this.saveProject())) {
      console.error("[PlaySystem] Failed to save project before playing");
      this.showError(
        "Failed to save project before playing. Please try saving manually first."
      );
      return false;
    }

    // Start playing based on mode
    return this.startPlay(playMode);
  }

  /**
   * Validate the current level for issues
   * @returns {boolean} True if level is valid, false if there are issues
   */
  validateLevel(playMode) {
    const validator = globalThis._editorScope?.levelValidator;
    if (!validator) {
      console.warn(
        "[PlaySystem] No level validator available, skipping validation"
      );
      return true; // Allow play if no validator
    }

    // Run validation
    const errors = validator.validate();
    const isValid = errors.length === 0;

    if (!isValid) {
      console.log(
        "[PlaySystem] Level validation failed, showing issues dialog"
      );

      // Show validation dialog with issues
      if (globalThis._editorScope.validationDialog) {
        globalThis._editorScope.validationDialog.show();
      }

      return false;
    }

    if (playMode !== PlayMode.PLAY_LEVEL) {
      // validate other levels
      // TODO: Figure out how to validate other levels
    }
    return true;
  }

  /**
   * Save the current project
   * @returns {Promise<boolean>} Success status
   */
  async saveProject() {
    const projectManager = globalThis._editorScope?.projectManager;
    if (!projectManager) {
      return false;
    }

    // Save current level state
    projectManager.saveCurrentLevelState();
    await projectManager.saveProjectToFile(false); // false = don't force "Save As"

    return true;
  }

  /**
   * Start playing the level/project
   * @param {string} playMode - The play mode
   * @returns {boolean} Success status
   */
  startPlay(playMode) {
    try {
      // Get the level loader
      const levelLoader = globalThis.levelLoader;
      if (!levelLoader) {
        console.error("[PlaySystem] Level loader not available");
        this.showError(
          "Level loader system not available. Cannot start play mode."
        );
        return false;
      }

      const projectManager = globalThis._editorScope?.projectManager;
      // Get current project data
      const projectJson = projectManager.exportProject();
      const projectData = JSON.parse(projectJson);

      // Load project into level loader
      levelLoader
        .loadProject(projectData)
        .then((success) => {
          if (!success) {
            this.showError("Failed to load project for playing");
            return;
          }

          // Store the project path for persistence
          this.storeLastOpenedProject();

          // Configure based on play mode
          const config = this.getPlayConfiguration(playMode, projectData);

          if (!levelLoader.configure(config)) {
            this.showError("Failed to configure play session");
            return;
          }

          // Start playing
          levelLoader.start();

          console.log(`[PlaySystem] Started playing in mode: ${playMode}`);
        })
        .catch((error) => {
          console.error("[PlaySystem] Error starting play:", error);
          this.showError("Error starting play mode: " + error.message);
        });

      return true;
    } catch (error) {
      console.error("[PlaySystem] Error in startPlay:", error);
      this.showError("Unexpected error starting play mode");
      return false;
    }
  }

  /**
   * Get play configuration based on play mode
   * @param {string} playMode - The play mode
   * @param {Object} projectData - Project data
   * @returns {Object} Configuration for level loader
   */
  getPlayConfiguration(playMode, projectData) {
    switch (playMode) {
      case PlayMode.PLAY_LEVEL:
        return {
          startLevelId: projectData.currentLevelId,
          returnDestination: "levelEditor",
          targetLayout: "levelEditorPreview",
          packCompletionMode:
            PackCompletionMode?.END_OF_ANY_LEVEL || "end_of_any_level",
        };

      case PlayMode.PLAY_PROJECT_HERE:
        return {
          startLevelId: projectData.currentLevelId,
          returnDestination: "levelEditor",
          targetLayout: "levelEditorPreview",
          packCompletionMode:
            PackCompletionMode?.END_OF_LAST_LEVEL || "end_of_last_level",
        };

      case PlayMode.PLAY_PROJECT_START:
        // Find first level in the project
        const levelIds = Object.keys(projectData.levels);
        const firstLevelId =
          levelIds.length > 0 ? levelIds[0] : projectData.currentLevelId;

        return {
          startLevelId: firstLevelId,
          returnDestination: "levelEditor",
          targetLayout: "levelEditorPreview",
          packCompletionMode:
            PackCompletionMode?.END_OF_LAST_LEVEL || "end_of_last_level",
        };

      default:
        console.warn(`[PlaySystem] Unknown play mode: ${playMode}`);
        return this.getPlayConfiguration(PlayMode.PLAY_LEVEL, projectData);
    }
  }

  /**
   * Store the last opened project for persistence
   */
  storeLastOpenedProject() {
    const projectManager = globalThis._editorScope?.projectManager;
    const stateManager = globalThis._editorScope?.stateManager;
    const levelLoader = globalThis.levelLoader;

    if (!projectManager || !levelLoader) return;

    try {
      const fileHandle = projectManager.getCurrentFileHandle();
      const projectInfo = projectManager.getProjectInfo();
      const projectId = projectManager.getCurrentProjectId();

      if (fileHandle && projectInfo && projectId) {
        const projectData = {
          projectId: projectId,
          projectName: projectInfo.projectName, // Keep name as fallback
          hasFileHandle: true,
          timestamp: Date.now(),
        };

        // Store project data
        levelLoader.setTempData("lastProject", projectData);

        console.log(
          "[PlaySystem] Stored project data in temp storage with ID:",
          projectId
        );
      }
    } catch (error) {
      console.warn("[PlaySystem] Could not store project data:", error);
    }
  }

  /**
   * Try to restore the last opened project on level editor startup
   */
  tryRestoreLastProject() {
    // Only try restore if no project is currently loaded
    const projectManager = globalThis._editorScope?.projectManager;
    const stateManager = globalThis._editorScope?.stateManager;
    const levelLoader = globalThis.levelLoader;

    if (!projectManager || projectManager.hasProjectLoaded() || !levelLoader) {
      return;
    }

    try {
      const projectData = levelLoader.getTempData("lastProject");
      if (!projectData) {
        console.log("[PlaySystem] No temp project data found");
        return;
      }

      // Use project ID if available, fallback to project name for backwards compatibility
      const identifier = projectData.projectId || projectData.projectName;
      const useId = !!projectData.projectId;

      console.log(
        `[PlaySystem] Found recent project: ${projectData.projectName} (${
          useId ? "ID: " + identifier : "Name: " + identifier
        })`
      );

      // Try to restore from recent projects
      const restored = this.tryRestoreFromRecentProjects(identifier, useId);

      if (restored) {
        const ghostPathManager =
          globalThis._editorScope?.ghostPathSystem?.manager;
        if (ghostPathManager) {
          // Allow loading from temp data since we're returning from play
          ghostPathManager.allowLoadingFromTempData();
        }
      }
      // Clear temp data after use
      levelLoader.removeTempData("lastProject");
      levelLoader.removeTempData("undoRedoState");
    } catch (error) {
      console.warn("[PlaySystem] Error trying to restore last project:", error);
      // Clear invalid data
      if (levelLoader) {
        levelLoader.removeTempData("lastProject");
        levelLoader.removeTempData("undoRedoState");
      }
    }
  }

  /**
   * Try to restore project from recent projects list
   * @param {string} identifier - Project ID or name to restore
   * @param {boolean} useId - Whether to search by ID (true) or name (false)
   * @returns {boolean} True if project was found and restored
   */
  tryRestoreFromRecentProjects(identifier, useId = true) {
    const welcomeDialog = globalThis._editorScope?.welcomeDialog;
    if (!welcomeDialog) return false;

    // Get recent projects
    const recentProjects = welcomeDialog.getRecentProjects();

    // Find matching project by ID or name
    const matchingProject = recentProjects.find((project) => {
      if (useId) {
        return project.id === identifier;
      } else {
        return project.name === identifier;
      }
    });

    if (matchingProject) {
      console.log(
        `[PlaySystem] Found matching project by ${
          useId ? "ID" : "name"
        }: ${identifier}`
      );

      // Load the project using the welcome dialog's method
      welcomeDialog.handleOpenRecentProject(matchingProject);
      return true;
    } else {
      console.log(
        `[PlaySystem] Could not find matching project in recent projects (${
          useId ? "ID" : "name"
        }: ${identifier})`
      );
      return false;
    }
  }

  /**
   * Show error message to user
   * @param {string} message - Error message to display
   */
  showError(message) {
    console.error(`[PlaySystem] ${message}`);

    // Use the notification system if available
    const notifications = globalThis._editorScope?.notifications;
    if (notifications) {
      notifications.error(message, { title: "Play Error" });
    } else {
      // Fallback to browser alert if notifications not available
      if (typeof alert !== "undefined") {
        alert(`Play Error: ${message}`);
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy() {}
}

// Singleton instance
let playSystemInstance = null;

/**
 * Initialize the play system
 * @returns {PlaySystem} The play system instance
 */
export function initializePlaySystem() {
  if (!playSystemInstance) {
    playSystemInstance = new PlaySystem();
    // Initialize
    playSystemInstance.init();
  }
  return playSystemInstance;
}

/**
 * Get the play system instance
 * @returns {PlaySystem|null} The play system instance
 */
export function getPlaySystem() {
  return playSystemInstance;
}

/**
 * Destroy the play system
 */
export function destroyPlaySystem() {
  if (playSystemInstance) {
    playSystemInstance.destroy();
    playSystemInstance = null;
  }
}
