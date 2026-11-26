using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class PortableLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            Application.EnableVisualStyles();
            string baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AshareYidongRadar");
            string appExe = Path.Combine(baseDir, "AshareYidongRadar.exe");
            string appAsar = Path.Combine(baseDir, "resources", "app.asar");

            if (!File.Exists(appExe) || !File.Exists(appAsar))
            {
                if (Directory.Exists(baseDir))
                {
                    Directory.Delete(baseDir, true);
                }
                Directory.CreateDirectory(baseDir);

                string zipPath = Path.Combine(Path.GetTempPath(), "AshareYidongRadar-payload.zip");
                using (Stream resource = Assembly.GetExecutingAssembly()
                    .GetManifestResourceStream("payload.zip"))
                {
                    if (resource == null)
                    {
                        throw new InvalidOperationException("内置运行包缺失。");
                    }
                    using (FileStream output = File.Create(zipPath))
                    {
                        resource.CopyTo(output);
                    }
                }
                try
                {
                    ZipFile.ExtractToDirectory(zipPath, baseDir);
                }
                finally
                {
                    try { File.Delete(zipPath); } catch { }
                }
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = appExe,
                WorkingDirectory = baseDir,
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "启动失败：\r\n" + error.Message +
                "\r\n\r\n也可以解压便携 ZIP 后直接运行 AshareYidongRadar.exe。",
                "A股异动雷达",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
