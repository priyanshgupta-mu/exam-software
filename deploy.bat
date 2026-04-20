@echo off
echo ========================================
echo   Firebase Deploy - ExamApp
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Logging into Firebase...
echo (A browser window will open - sign in with your Google account)
echo.
call npx firebase-tools login
if errorlevel 1 (
    echo.
    echo ERROR: Login failed. Please try again.
    pause
    exit /b 1
)

echo.
echo [2/3] Building production bundle...
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Deploying to Firebase Hosting...
call npx firebase-tools deploy --only hosting
if errorlevel 1 (
    echo.
    echo ERROR: Deploy failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   DEPLOYED SUCCESSFULLY!
echo   Your app is now live.
echo ========================================
echo.
pause
