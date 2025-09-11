#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from collections import defaultdict
import re
import xlrd
import xlwt
import os
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
            
            # Пробуем открыть файл
            try:
                # Сначала читаем файл
                workbook = xlrd.open_workbook(filepath)
                sheet = workbook.sheet_by_index(0)
                
                # Проверяем первую строку
                first_cell = str(sheet.cell_value(0, 0)) if sheet.nrows > 0 else ""
                
                # Если первая строка содержит "Журнал событий" - создаем новый файл без неё
                if 'Журнал событий' in first_cell:
                    # Создаем новый workbook
                    new_workbook = xlwt.Workbook()
                    new_sheet = new_workbook.add_sheet('Sheet1')
                    
                    # Копируем все строки кроме первой
                    for row_idx in range(1, sheet.nrows):
                        for col_idx in range(sheet.ncols):
                            try:
                                value = sheet.cell_value(row_idx, col_idx)
                                new_sheet.write(row_idx - 1, col_idx, value)
                            except:
                                pass
                    
                    # Сохраняем временный файл
                    temp_filepath = filepath + '.temp.xls'
                    new_workbook.save(temp_filepath)
                    
                    # Теперь читаем временный файл
                    workbook = xlrd.open_workbook(temp_filepath)
                    sheet = workbook.sheet_by_index(0)
                    
                    # Удаляем временный файл после чтения
                    try:
                        os.remove(temp_filepath)
                    except:
                        pass
                
            except Exception as e:
                return {
                    'success': False,
                    'error': f"Не удалось открыть файл: {str(e)}",
                    'has_errors': False
                }
            
            # Теперь ищем начало данных (заголовки должны быть в первой строке)
            start_row = 1  # Пропускаем строку с заголовками
            
            # Парсим каждую строку
            for row_idx in range(start_row, sheet.nrows):
                try:
                    # Читаем значения
                    datetime_str = str(sheet.cell_value(row_idx, 0)) if sheet.cell_value(row_idx, 0) else ""
                    event = str(sheet.cell_value(row_idx, 1)) if sheet.cell_value(row_idx, 1) else ""
                    
                    # Пропускаем пустые строки
                    if not datetime_str or not event or datetime_str == '0':
                        continue
                    
                    # Проверяем что это не заголовок
                    if datetime_str == 'Время':
                        continue
                    
                    voltage_str = str(sheet.cell_value(row_idx, 2)).replace(',', '.') if sheet.cell_value(row_idx, 2) else "0"
                    percent_str = str(sheet.cell_value(row_idx, 3)).replace(',', '.') if sheet.cell_value(row_idx, 3) else "0"
                    duration_str = str(sheet.cell_value(row_idx, 4)).replace(',', '.') if sheet.cell_value(row_idx, 4) else "0"
                    
                    # Преобразуем в числа
                    try:
                        voltage = float(voltage_str)
                        percent = float(percent_str)
                        duration = float(duration_str)
                    except ValueError:
                        continue
                    
                    # Критерий 1: продолжительность > 60
                    if duration <= 60:
                        continue
                    
                    # Критерий 2: напряжение != 11.50 и != 0
                    if abs(voltage - 11.50) < 0.001 or voltage == 0:
                        continue
                    
                    # Определяем месяц из даты
                    date_match = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', datetime_str)
                    if date_match:
                        month = int(date_match.group(2))
                    else:
                        continue
                    
                    # Определяем тип события и фазу
                    phase = None
                    event_type = None
                    
                    # Проверяем фазу
                    event_lower = event.lower()
                    if 'фаза a' in event_lower:
                        phase = 'A'
                    elif 'фаза b' in event_lower:
                        phase = 'B'
                    elif 'фаза c' in event_lower:
                        phase = 'C'
                    
                    if phase:
                        # Проверяем тип события (только окончание)
                        if 'окончание' in event_lower:
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
                        
                except Exception:
                    continue
            
            # Формируем результат
            return self._generate_result(events_data)
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Ошибка анализа файла: {str(e)}",
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
