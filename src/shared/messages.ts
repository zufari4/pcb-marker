import type { Settings } from "./model";
export function resolveLanguage(
  setting: Settings["language"],
  systemLocale: string,
): "ru" | "en" {
  return setting === "system"
    ? systemLocale.toLowerCase().startsWith("ru")
      ? "ru"
      : "en"
    : setting;
}
const translations: Record<string, string> = {
  "Считайте все четыре угла заготовки.": "Read all four blank corners.",
  "Углы перепутаны или совпадают.": "Corners are out of order or overlap.",
  "Углы не образуют прямоугольник: отклонение":
    "Corners do not form a rectangle: deviation",
  "Рисунок больше заготовки, измеренной по углам. Масштаб остаётся 1:1.":
    "The drawing exceeds the measured blank. Scale stays 1:1.",
  "В архиве нет выбранной стороны платы.":
    "The archive does not contain the selected side.",
  "На выбранной стороне нет траекторий.":
    "There are no paths on the selected side.",
  "Сопло выходит за допустимую область:":
    "The nozzle exceeds the motion limits:",
  "Высота переходов превышает 250 мм": "Travel height exceeds 250 mm",
  "Некорректный адрес": "Invalid address",
  "В Gerber нет замкнутого контура платы.":
    "Gerber has no closed board outline.",
  "Разрыв связной траектории.": "Disconnected path traversal.",
  "Неизвестная апертура": "Unknown aperture",
  "Архив слишком большой.": "The archive is too large.",
  "Неоднозначный слой:": "Ambiguous layer:",
  "В ZIP нет контура платы (.GKO / Edge_Cuts).":
    "The ZIP has no board outline (.GKO / Edge_Cuts).",
  "Нет файла сверловки: центры колец определяются только апертурами Gerber.":
    "No drill file: pad rings can only use holes defined in Gerber apertures.",
  "В ZIP нет медных слоёв .GTL / .GBL.":
    "The ZIP has no .GTL / .GBL copper layers.",
  "ZIP больше 64 МБ.": "The ZIP exceeds 64 MB.",
  "Выберите Gerber ZIP.": "Choose a Gerber ZIP.",
  "Дождитесь завершения задания.": "Wait until the job finishes.",
  "Обработка Gerber прервана": "Gerber processing interrupted",
  "Предыдущая команда ещё выполняется.":
    "The previous command is still running.",
  "Голова переместилась после подготовки. Повторите запуск.":
    "The head moved after preparation. Start again.",
  "Нет активного задания.": "There is no active job.",
  "Это задание больше не выполняется на принтере.":
    "This job is no longer running on the printer.",
  "Координаты Home потеряны. Автоматическое движение невозможно.":
    "Homing coordinates were lost. Automatic movement is unavailable.",
  "Задание не на паузе.": "The job is not paused.",
  "На принтере выбрано другое задание.":
    "A different job is selected on the printer.",
  "Соединение с принтером потеряно.": "Connection to the printer was lost.",
  "Для доступа к Klipper нужен SSH StreamLocal, nc с поддержкой -U или socat.":
    "Klipper requires SSH StreamLocal, nc with -U support, or socat.",
  "Неизвестный каталог заданий Klipper.": "Unknown Klipper job directory.",
  "Klipper отключён.": "Klipper disconnected.",
  "Некорректный ответ Klipper.": "Invalid Klipper response.",
  "Принтер не подключён.": "The printer is not connected.",
  "Принтер не ответил вовремя. Проверьте состояние перед повтором команды.":
    "The printer timed out. Check its state before retrying.",
  "Некорректное имя задания.": "Invalid job filename.",
  "Контрольная сумма G-code не совпала.": "G-code checksum mismatch.",
  "SSH не подключён.": "SSH is not connected.",
  "Истекло время команды SSH.": "SSH command timed out.",
  "Соединение закрыто.": "Connection closed.",
  "Принтер занят.": "The printer is busy.",
  "Нужен Home X/Y/Z. Выполните его без мешающих платы и маркера, затем проверьте привязку и Z касания.":
    "Home X/Y/Z with the board and marker clear, then check registration and contact Z.",
  "Сначала выключите нагрев сопла и стола.":
    "Turn off nozzle and bed heating first.",
  "Дождитесь охлаждения сопла и стола ниже 45 °C.":
    "Wait for the nozzle and bed to cool below 45 °C.",
  "Недопустимый источник команды.": "Invalid command source.",
  "Настройки недоступны во время задания.":
    "Settings are unavailable during a job.",
  "Подключение уже выполняется.": "Connection is already in progress.",
  "Сначала завершите задание.": "Finish the current job first.",
  "Сначала откройте Gerber.": "Open a Gerber file first.",
  "Системное хранилище паролей недоступно.":
    "The system password vault is unavailable.",
};
export function localizeMessage(
  message: string,
  language: "ru" | "en",
): string {
  if (language === "ru") return message;
  let result = message;
  for (const [ru, en] of Object.entries(translations))
    result = result.replaceAll(ru, en);
  return result.replace(/ мм/g, " mm").replace(/строка/g, "line");
}
