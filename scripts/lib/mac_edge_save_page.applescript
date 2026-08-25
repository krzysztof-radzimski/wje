on run argv
  if (count of argv) is not 2 then error "Usage: adapter DESTINATION FILE_NAME"
  set destinationDirectory to item 1 of argv
  set outputName to item 2 of argv

  tell application "Microsoft Edge" to activate
  delay 0.5

  tell application "System Events"
    if UI elements enabled is false then error "macOS Accessibility is disabled for this process."
    if not (exists process "Microsoft Edge") then error "Microsoft Edge process is not running."

    tell process "Microsoft Edge"
      set frontmost to true
      keystroke "s" using command down

      set savePanel to missing value
      repeat 150 times
        try
          set savePanel to sheet 1 of front window
          exit repeat
        end try
        delay 0.1
      end repeat
      if savePanel is missing value then error "Microsoft Edge Save As panel did not appear."

      set completeFormatSelected to false
      set completeFormatNames to {"Webpage, Complete", "Complete Webpage", "Strona sieci web, kompletna", "Strona internetowa, kompletna", "Kompletna strona internetowa"}
      set allControls to entire contents of savePanel
      repeat with aControl in allControls
        try
          if role of aControl is "AXPopUpButton" then
            click aControl
            delay 0.2
            repeat with formatName in completeFormatNames
              if exists menu item (formatName as text) of menu 1 of aControl then
                click menu item (formatName as text) of menu 1 of aControl
                set completeFormatSelected to true
                exit repeat
              end if
            end repeat
            if completeFormatSelected then exit repeat
            key code 53
          end if
        end try
      end repeat
      if completeFormatSelected is false then
        try
          if exists button "Cancel" of savePanel then click button "Cancel" of savePanel
          if exists button "Anuluj" of savePanel then click button "Anuluj" of savePanel
        end try
        error "Microsoft Edge complete-webpage format is unavailable in the Save As panel."
      end if

      keystroke "g" using {command down, shift down}
      delay 0.3
      set goPanel to missing value
      repeat 50 times
        try
          set goPanel to sheet 1 of savePanel
          exit repeat
        end try
        delay 0.1
      end repeat
      if goPanel is missing value then error "Microsoft Edge Go to Folder panel did not appear."
      set value of text field 1 of goPanel to destinationDirectory
      keystroke return
      delay 0.5

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
      if nameField is missing value then error "Microsoft Edge Save As filename field was not found."
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
      if saveButton is missing value then error "Microsoft Edge Save button was not found."
      click saveButton

      repeat 300 times
        if not (exists savePanel) then exit repeat
        delay 0.1
      end repeat
      if exists savePanel then error "Microsoft Edge Save As panel did not close."
    end tell
  end tell

  return "saved " & outputName
end run
