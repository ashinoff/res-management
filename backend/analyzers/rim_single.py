#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from collections import defaultdict
import re
import xlrd
from datetime import datetime

class RIMAnalyzer:
    def __init__(self):
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ файла журнала событий"""
        try:
            # Структура для хранения событий
            events_data = {
                'overvoltage': {'A': [], 'B': [], 'C': []},
                'undervoltage': {'A': [], 'B': [], 'C': []}
            }
            
            # Открываем файл БЕЗ formatting_info - это ключевой момент!
            try:
                # НЕ используем formatting_info=True для проблемных файлов
                workbook = xlrd.open_workbook(filepath, formatting_info=False, on_demand=True)
                sheet = workbook.sheet_by_index(0)
            except Exception as e:
                return {
                    'success': False,
                    'error': f"Не удалось открыть файл: {str(e)}",
                    'has_errors': False
                }
            
            # Умный поиск начала данных
            start_row = 0
            for i in range(0, min(10, sheet.nrows)):
                try:
                    cell0 = str(sheet.cell_value(i, 0)).strip()
                    
                    # Пропускаем строки с заголовком журнала
                    if 'Журнал событий' in cell0:
                        continue
                        
                    # Нашли заголовки колонок
                    if 'Время' in cell0:
                        start_row = i + 1  # Данные начинаются со следующей строки
                        break
                        
                    # Нашли первую дату - это уже данные
                    if re.match(r'\d{2}\.\d{2}\.\d{4}', cell0):
                        start_row = i
                        break
                except:
                    continue
            
            # Если не нашли начало, пробуем с первой строки
            if start_row == 0:
                start_row = 1
            
            # Парсим данные
            for row_idx in range(start_row, sheet.nrows):
                try:
                    # Безопасное чтение ячеек
                    datetime_str = ""
                    event = ""
                    voltage = 0.0
                    percent = 0.0
                    duration = 0.0
                    
                    # Проверяем количество колонок
                    if sheet.ncols >= 5:
                        # Читаем значения
                        cell_date = sheet.cell_value(row_idx, 0)
                        cell_event = sheet.cell_value(row_idx, 1)
                        cell_voltage = sheet.cell_value(row_idx, 2)
                        cell_percent = sheet.cell_value(row_idx, 3)
                        cell_duration = sheet.cell_value(row_idx, 4)
                        
                        # Преобразуем в строки
                        datetime_str = str(cell_date).strip()
                        event = str(cell_event).strip()
                        
                        # Числовые значения
                        try:
                            # xlrd может вернуть float напрямую
                            if isinstance(cell_voltage, (int, float)):
                                voltage = float(cell_voltage)
                            else:
                                voltage = float(str(cell_voltage).replace(',', '.'))
                                
                            if isinstance(cell_percent, (int, float)):
                                percent = float(cell_percent)
                            else:
                                percent = float(str(cell_percent).replace(',', '.'))
                                
                            if isinstance(cell_duration, (int, float)):
                                duration = float(cell_duration)
                            else:
                                duration = float(str(cell_duration).replace(',', '.'))
                        except:
                            continue
                    else:
                        continue
                    
                    # Пропускаем пустые строки и заголовки
                    if not datetime_str or not event:
                        continue
                    if datetime_str == 'Время':
                        continue
                    
                    # Проверяем формат даты
                    date_match = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', datetime_str)
                    if not date_match:
                        continue
                    
                    # Критерии фильтрации
                    if duration <= 60:
                        continue
                    if abs(voltage - 11.50) < 0.001 or voltage == 0:
                        continue
                    
                    # Извлекаем месяц
                    month = int(date_match.group(2))
                    
                    # Определяем фазу и тип события
                    phase = None
                    event_type = None
                    
                    # Определяем фазу
                    event_lower = event.lower()
                    if 'фаза a' in event_lower:
                        phase = 'A'
                    elif 'фаза b' in event_lower:
                        phase = 'B'
                    elif 'фаза c' in event_lower:
                        phase = 'C'
                    
                    # Определяем тип только для событий окончания
                    if phase and 'окончание' in event_lower:
                        if 'провал' in event_lower:
                            event_type = 'undervoltage'
                        elif 'перенапряжение' in event_lower:
                            event_type = 'overvoltage'
                    
                    # Добавляем событие
                    if phase and event_type:
                        events_data[event_type][phase].append({
                            'voltage': voltage,
                            'month': month,
                            'duration': duration
                        })
                        
                except Exception as e:
                    # Пропускаем проблемные строки
                    continue
            
            # Формируем результат
            return self._generate_result(events_data)
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Ошибка анализа: {str(e)}",
                'has_errors': False
            }
    
    def _generate_result(self, events_data):
        """Генерация результата анализа"""
        summary_parts = []
        has_errors = False
        details = {
            'overvoltage': {},
            'undervoltage': {}
        }
        
        # Обработка перенапряжений
        for phase in ['A', 'B', 'C']:
            events = events_data['overvoltage'][phase]
            # Критерий 3: количество > 10
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                
                if min_month == max_month:
                    period = self.ru_months[min_month-1]
                else:
                    period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                
                voltages = [e['voltage'] for e in events]
                max_voltage = max(voltages)
                min_voltage_in_overvoltage = min(voltages)
                count = len(events)
                
                # Расчет процентов для диапазона
                min_percent = ((min_voltage_in_overvoltage - 220) / 220) * 100
                max_percent = ((max_voltage - 220) / 220) * 100
                
                summary_parts.append(
                    f"Фаза {phase}: Перенапряжение {min_percent:.1f}-{max_percent:.1f}% (max {max_voltage:.0f}В) ({period}) - {count} событий"
                )
                
                details['overvoltage'][f'phase_{phase}'] = {
                    'count': count,
                    'max': max_voltage,
                    'period': period
                }
        
        # Обработка провалов
        for phase in ['A', 'B', 'C']:
            events = events_data['undervoltage'][phase]
            # Критерий 3: количество > 10
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                
                if min_month == max_month:
                    period = self.ru_months[min_month-1]
                else:
                    period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                
                voltages = [e['voltage'] for e in events]
                min_voltage = min(voltages)
                max_voltage_in_undervoltage = max(voltages)
                count = len(events)
                
                # Расчет процентов для диапазона
                min_percent = ((220 - max_voltage_in_undervoltage) / 220) * 100
                max_percent = ((220 - min_voltage) / 220) * 100
                
                summary_parts.append(
                    f"Фаза {phase}: Провал {min_percent:.1f}-{max_percent:.1f}% (min {min_voltage:.0f}В) ({period}) - {count} событий"
                )
                
                details['undervoltage'][f'phase_{phase}'] = {
                    'count': count,
                    'min': min_voltage,
                    'period': period
                }
        
        # Если событий меньше 10, но есть события
        if not has_errors:
            total_events = sum(len(events) for events in events_data['overvoltage'].values())
            total_events += sum(len(events) for events in events_data['undervoltage'].values())
            
            if total_events > 0:
                summary = f"Обнаружено событий: {total_events}, но все менее 10 по каждому типу"
            else:
                summary = "Напряжение в пределах ГОСТ"
        else:
            summary = '; '.join(summary_parts)
        
        return {
            'success': True,
            'summary': summary,
            'has_errors': has_errors,
            'details': details
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No file path provided'}))
        sys.exit(1)
    
    try:
        analyzer = RIMAnalyzer()
        result = analyzer.analyze_file(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
