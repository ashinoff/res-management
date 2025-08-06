#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from collections import defaultdict
import re
import xlrd  # для чтения .xls файлов
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
            
            # Читаем Excel файл
            workbook = xlrd.open_workbook(filepath)
            sheet = workbook.sheet_by_index(0)  # Берем первый лист
            
            print(f"Sheet rows: {sheet.nrows}, cols: {sheet.ncols}", file=sys.stderr)

            # Выведем первые 5 строк для проверки структуры
            print("First 5 rows:", file=sys.stderr)
            for i in range(min(5, sheet.nrows)):
                row = []
                for j in range(sheet.ncols):
                    row.append(str(sheet.cell_value(i, j))[:30])  # первые 30 символов
                print(f"Row {i}: {row}", file=sys.stderr)
            
            # Начинаем со 2-й строки (индекс 1), пропуская заголовок
            start_row = 1
            
            # Парсим каждую строку
            for row_idx in range(start_row, sheet.nrows):
                try:
                    # Читаем ячейки строки по правильным колонкам
                    datetime_str = str(sheet.cell_value(row_idx, 0))  # Колонка A - дата и время
                    event = str(sheet.cell_value(row_idx, 1))  # Колонка B - событие
                    
                    # Пропускаем пустые строки
                    if not datetime_str or not event or datetime_str == '0':
                        continue
# ДОБАВЬ ЭТУ ПРОВЕРКУ - пропускаем строки с текстовыми заголовками
                    if 'Дата' in datetime_str or 'Напряжение' in event or 'напряжение' in event.lower():
                        print(f"Row {row_idx}: skipping header row", file=sys.stderr)
                        continue
                    
                    # Колонка C - напряжение, D - процент, E - продолжительность
                    voltage_str = str(sheet.cell_value(row_idx, 2)).replace(',', '.')  # Колонка C
                    
                    try:
                        voltage = float(voltage_str)
                    except ValueError:
                        print(f"Row {row_idx}: cannot parse voltage '{voltage_str}', skipping", file=sys.stderr)
                        continue
            
                    percent_str = str(sheet.cell_value(row_idx, 3)).replace(',', '.')  # Колонка D
                    duration_str = str(sheet.cell_value(row_idx, 4)).replace(',', '.')  # Колонка E
                    
                    # Проверяем на пустые значения
                    if not voltage_str or not percent_str or not duration_str:
                        print(f"Row {row_idx}: empty values, skipping", file=sys.stderr)
                        continue
                    
                    voltage = float(voltage_str)
                    percent = float(percent_str)
                    duration = float(duration_str)
                    
                    # ОТЛАДКА
                    print(f"Row {row_idx}: event='{event}', voltage={voltage}, duration={duration}", file=sys.stderr)
                    
                    # Критерий 1: продолжительность > 60
                    if duration <= 60:
                        print(f"Skipped: duration {duration} <= 60", file=sys.stderr)
                        continue
                    
                    # Критерий 2: напряжение != 11.50 и != 0
                    if abs(voltage - 11.50) < 0.001 or voltage == 0:
                        print(f"Skipped: voltage {voltage} is 11.50 or 0", file=sys.stderr)
                        continue
                    
                    # Определяем месяц из даты
                    date_match = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', datetime_str)
                    if date_match:
                        month = int(date_match.group(2))
                    else:
                        print(f"Could not parse date from: {datetime_str}", file=sys.stderr)
                        continue
                    
                    # Определяем тип события и фазу
                    phase = None
                    event_type = None
                    
                    # Проверяем фазу
                    if 'Фаза A' in event or 'фаза A' in event:
                        phase = 'A'
                    elif 'Фаза B' in event or 'фаза B' in event:
                        phase = 'B'
                    elif 'Фаза C' in event or 'фаза C' in event:
                        phase = 'C'
                    
                    print(f"Detected phase: {phase}", file=sys.stderr)
                    
                    if phase:
                        # Проверяем тип события
                        if 'провал' in event.lower():
                            event_type = 'undervoltage'
                        elif 'перенапряжение' in event.lower():
                            event_type = 'overvoltage'
                    
                    print(f"Event type: {event_type}", file=sys.stderr)
                    
                    # Добавляем событие
                    if phase and event_type:
                        events_data[event_type][phase].append({
                            'voltage': voltage,
                            'month': month,
                            'duration': duration
                        })
                        print(f"Added event: {event_type} phase {phase}", file=sys.stderr)
                    else:
                        print(f"Event not added: phase={phase}, type={event_type}", file=sys.stderr)
                        
                except Exception as e:
                    print(f"Error in row {row_idx}: {str(e)}", file=sys.stderr)
                    continue
            
            # Формируем результат
            return self._generate_result(events_data)
            
        except xlrd.biffh.XLRDError as e:
            return {
                'success': False,
                'error': f"Ошибка чтения Excel файла: {str(e)}",
                'has_errors': False
            }
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
        
        # ОТЛАДКА - выводим количество событий
        total_overvoltage = sum(len(events) for events in events_data['overvoltage'].values())
        total_undervoltage = sum(len(events) for events in events_data['undervoltage'].values())
        print(f"Total overvoltage events: {total_overvoltage}", file=sys.stderr)
        print(f"Total undervoltage events: {total_undervoltage}", file=sys.stderr)
        
        # Обработка перенапряжений
        for phase, events in events_data['overvoltage'].items():
            print(f"Overvoltage phase {phase}: {len(events)} events", file=sys.stderr)
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
                
                max_voltage = max(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}>10% – {count} шт, Umax={max_voltage:.2f}"
                )
                
                details['overvoltage'][phase] = {
                    'count': count,
                    'max': max_voltage,
                    'period': period
                }
        
        # Обработка провалов
        for phase, events in events_data['undervoltage'].items():
            print(f"Undervoltage phase {phase}: {len(events)} events", file=sys.stderr)
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
                
                min_voltage = min(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}<10% – {count} шт, Umin={min_voltage:.2f}"
                )
                
                details['undervoltage'][phase] = {
                    'count': count,
                    'min': min_voltage,
                    'period': period
                }
        
        # Если событий меньше 10, но есть события - для отладки
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
