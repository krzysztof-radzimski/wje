on run argv
  if (count of argv) is not 3 then error "Usage: adapter DESTINATION FILE_NAME PROCESS_NAME"
  set destinationDirectory to item 1 of argv
  set outputName to item 2 of argv
  set chromeProcessName to item 3 of argv

  tell application "Google Chrome" to activate
  delay 0.4

  tell application "System Events"
    if UI elements enabled is false then error "macOS Accessibility is disabled for this process."
    if not (exists process chromeProcessName) then error "Google Chrome process is not running."

    tell process chromeProcessName
      set frontmost to true
      keystroke "s" using command down

      set savePanel to missing value
      repeat 100 times
        try
          set savePanel to sheet 1 of front window
          exit repeat
        end try
        delay 0.1
      end repeat
      if savePanel is missing value then error "Chrome Save As panel did not appear."

      set completeFormatSelected to false
      set allControls to entire contents of savePanel
      repeat with aControl in allControls
        try
          if role of aControl is "AXPopUpButton" then
            click aControl
            delay 0.15
            if exists menu item "Webpage, Complete" of menu 1 of aControl then
              click menu item "Webpage, Complete" of menu 1 of aControl
              set completeFormatSelected to true
              exit repeat
            else if exists menu item "Kompletna strona internetowa" of menu 1 of aControl then
              click menu item "Kompletna strona internetowa" of menu 1 of aControl
              set completeFormatSelected to true
              exit repeat
            else
              key code 53
            end if
          end if
        end try
      end repeat
      if completeFormatSelected is false then error "Chrome complete-webpage format is unavailable in the Save As panel."

      keystroke "g" using {command down, shift down}
      delay 0.3
      set goPanel to sheet 1 of savePanel
      set value of text field 1 of goPanel to destinationDirectory
      keystroke return
      delay 0.4

      set nameField to missing value
      set allControls to entire contents of savePanel
      repeat with aControl in allControls
        try
          if role of aControl is "AXTextField" and enabled of aControl is true then
            set nameField to aControl
            exit repeat
          end if
        end try
      end repeat
      if nameField is missing value then error "Save As filename field was not found."
      set value of nameField to outputName

      set saveButton to missing value
      try
        set saveButton to button "Save" of savePanel
      end try
      if saveButton is missing value then
        try
          set saveButton to button "Zapisz" of savePanel
        end try
      end if
      if saveButton is missing value then error "Save button was not found in the Save As panel."
      click saveButton

      repeat 150 times
        if not (exists savePanel) then exit repeat
        delay 0.1
      end repeat
      if exists savePanel then error "Chrome Save As panel did not close."
    end tell
  end tell

  return "saved " & outputName
end run
