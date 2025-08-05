#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pandas as pd
import sys
import json
from datetime import datetime
from collections import defaultdict
import os

class RIMAnalyzer:
    def __init__(self):
        self.voltage_events = []
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ файла журнала событий РИМ"""
        try:
            # Читаем Excel файл, пропускаем первую строку с заголовком
            df = pd.read_excel(filepath, header=1)
            
            # Переименовываем колонки для удобства
            df.columns = ['datetime', 'event', 'voltage', 'depth', 'duration'] + list(df.columns[5:])
            
            results = {
                'processed': True,
                'errors': [],
                'overvoltage': defaultdict(list),
                'undervoltage': defaultdict(list)
            }
            
            for idx, row in df.iterrows():
                try:
                    event = str(row['event'])
                    duration = float(row['duration']) if pd.notna(row['duration']) else 0
                    voltage_str = str(row['voltage']).replace(',', '.')
                    voltage = float(voltage_str) if voltage_str != 'nan' else 0
                    
                    # Парсим дату
                    date_val = pd.to_datetime(row['datetime'], format='%d.%m.%Y', errors='coerce')
                    if pd.isna(date_val):
                        continue
                    date_str = date_val.strftime('%d.%m.%Y')
                    
                    # Фильтруем только события длительностью > 60 сек
                    if duration <= 60:
                        continue
                    
                    # Прерывание напряжения - окончание (это перенапряжение в контексте задачи)
                    if 'Прерывание напряжения - окончание' in event:
                        # Определяем фазы по предыдущим строкам
                        # Это общее событие, нужно смотреть контекст
                        continue
                    
                    # Пропадание = провал (undervoltage)
                    if 'пропадание напряжения' in event:
                        if 'Фаза A' in event:
                            if abs(voltage - 11.5) > 0.001:
                                results['undervoltage']['A'].append({
                                    'date': date_str,
                                    'voltage': voltage,
                                    'month': date_val.month
                                })
                        elif 'Фаза B' in event:
                            if abs(voltage - 11.5) > 0.001:
                                results['undervoltage']['B'].append({
                                    'date': date_str,
                                    'voltage': voltage,
                                    'month': date_val.month
                                })
                        elif 'Фаза C' in event:
                            if abs(voltage - 11.5) > 0.001:
                                results['undervoltage']['C'].append({
                                    'date': date_str,
                                    'voltage': voltage,
                                    'month': date_val.month
                                })
                    
                    # Перенапряжение (overvoltage) - в этом файле не вижу таких событий
                    # Но оставляем логику на случай если встретятся
                    if 'перенапряжение' in event and 'окончание' in event:
                        phase = None
                        if 'Фаза A' in event: phase = 'A'
                        elif 'Фаза B' in event: phase = 'B'
                        elif 'Фаза C' in event: phase = 'C'
                        
                        if phase:
                            results['overvoltage'][phase].append({
                                'date': date_str,
                                'voltage': voltage,
                                'month': date_val.month
                            })
                            
                except Exception as e:
                    results['errors'].append(f"Строка {idx+3}: {str(e)}")
            
            # Формируем итоговую строку
            summary = self._generate_summary(results)
            
            return {
                'success': True,
                'summary': summary,
                'has_errors': bool(results['overvoltage'] or results['undervoltage']),
                'details': {
                    'overvoltage': dict(results['overvoltage']),
                    'undervoltage': dict(results['undervoltage'])
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Ошибка анализа файла: {str(e)}",
                'has_errors': False
            }
    
    def _generate_summary(self, results):
        """Генерация итоговой строки с результатами"""
        summary_parts = []
        
        # Обработка перенапряжений
        for phase, events in results['overvoltage'].items():
            if events:
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                max_voltage = max(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}>10% – {count} раз(а), Umax={max_voltage:.2f}"
                )
        
        # Обработка провалов
        for phase, events in results['undervoltage'].items():
            if events:
                months = [e['month'] for e in events]
                min_month = min(months) 
                max_month = max(months)
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                min_voltage = min(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}<10% – {count} раз(а), Umin={min_voltage:.2f}"
                )
        
        return '; '.join(summary_parts) if summary_parts else "Напряжение в пределах ГОСТ"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No file path provided'}))
        sys.exit(1)
    
    analyzer = RIMAnalyzer()
    result = analyzer.analyze_file(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
