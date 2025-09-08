// =====================================================
// УЛУЧШЕННЫЙ FRONTEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Файл: src/App.jsx
// Версия с исправленными фазами и загрузкой из АСКУЭ
// =====================================================

import React, { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import * as XLSX from 'xlsx';

// =====================================================
// НАСТРОЙКА API КЛИЕНТА
// =====================================================

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 60000
});

// Добавляем токен к каждому запросу
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обработка ошибок авторизации
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// =====================================================
// КОНТЕКСТ АВТОРИЗАЦИИ
// =====================================================

const AuthContext = createContext(null);

// =====================================================
// КОМПОНЕНТ АВТОРИЗАЦИИ
// =====================================================

function LoginForm({ onLogin }) {
  const [credentials, setCredentials] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await api.post('/api/auth/login', credentials);
      localStorage.setItem('token', response.data.token);
      onLogin(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h2>Вход в систему контроля уровня напряжения</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Логин</label>
            <input
              type="text"
              value={credentials.login}
              onChange={(e) => setCredentials({...credentials, login: e.target.value})}
              required
            />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              required
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
        <div className="test-accounts">
          <p>Тестовые учетные записи:</p>
          <p>admin / admin123</p>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// ГЛАВНОЕ МЕНЮ
// =====================================================

function MainMenu({ activeSection, onSectionChange, userRole }) {
  const [notificationCounts, setNotificationCounts] = useState({
    tech_pending: 0,
    askue_pending: 0,
    problem_vl: 0
  });

  // Загружаем количество уведомлений
  useEffect(() => {
    loadNotificationCounts();
    
    const interval = setInterval(loadNotificationCounts, 30000); // Обновляем каждые 30 сек
    
    // Слушаем события обновления
    const handleUpdate = () => loadNotificationCounts();
    window.addEventListener('notificationsUpdated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('notificationsUpdated', handleUpdate);
    };
  }, []);

  const loadNotificationCounts = async () => {
    try {
      const response = await api.get('/api/notifications/counts');
      setNotificationCounts(response.data);
    } catch (error) {
      console.error('Error loading notification counts:', error);
    }
  };

  const menuItems = [
    { id: 'structure', label: 'Структура сети', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'upload', label: 'Загрузить файлы', roles: ['admin', 'uploader'] },
    { id: 'tech_pending', label: 'Ожидающие мероприятий', roles: ['admin', 'res_responsible'], badge: notificationCounts.tech_pending },
    { id: 'askue_pending', label: 'Ожидающие проверки АСКУЭ', roles: ['admin', 'uploader'], badge: notificationCounts.askue_pending },
    { id: 'problem_vl', label: 'Проблемные ВЛ', roles: ['admin'], badge: notificationCounts.problem_vl },
    { id: 'documents', label: 'Загруженные документы', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'reports', label: 'Отчеты', roles: ['admin'] },
    { id: 'settings', label: 'Настройки', roles: ['admin'] }
  ];

  const visibleItems = menuItems.filter(item => item.roles.includes(userRole));

  return (
    <nav className="main-menu">
      <h3>Меню</h3>
      {visibleItems.map(item => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={`menu-item ${activeSection === item.id ? 'active' : ''}`}
        >
          <span className="menu-label">{item.label}</span>
          {item.badge > 0 && (
            <span className="notification-badge">{item.badge > 99 ? '99+' : item.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

// =====================================================
// КОМПОНЕНТ СТРУКТУРЫ СЕТИ
// =====================================================

function NetworkStructure({ selectedRes }) {
  const [networkData, setNetworkData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTp, setSearchTp] = useState('');
  const { user } = useContext(AuthContext);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  
  // Для редактирования
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  
  // Для выбора и удаления
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  
  // Оптимизированная функция загрузки
  const loadNetworkStructure = useCallback(async () => {
    try {
      const response = await api.get(`/api/network/structure/${selectedRes || ''}`);
      setNetworkData(response.data);
    } catch (error) {
      console.error('Error loading network structure:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRes]);

  useEffect(() => {
    loadNetworkStructure();
    
    // Слушаем события обновления
    const handleUpdate = () => loadNetworkStructure();
    
    window.addEventListener('structureUpdated', handleUpdate);
    window.addEventListener('dataCleared', handleUpdate);
    window.addEventListener('structureDeleted', handleUpdate);
    
    return () => {
      window.removeEventListener('structureUpdated', handleUpdate);
      window.removeEventListener('dataCleared', handleUpdate);
      window.removeEventListener('structureDeleted', handleUpdate);
    };
  }, [loadNetworkStructure]);

  const getStatusColor = (status) => {
    switch(status) {
      case 'checked_ok': return 'status-ok';
      case 'checked_error': return 'status-error';
      case 'not_checked': return 'status-unchecked';
      case 'pending_recheck': return 'status-pending';
      case 'empty': return 'status-empty';
      default: return 'status-empty';
    }
  };

  const handleCellClick = (item, position) => {
    const puNumber = position === 'start' ? item.startPu : 
                     position === 'middle' ? item.middlePu : 
                     item.endPu;
    
    if (puNumber && item.PuStatuses) {
      const status = item.PuStatuses.find(s => 
        s.puNumber === puNumber && s.position === position
      );
      
      if (status && status.status === 'checked_error') {
        setSelectedDetails(status);
        setSelectedItem(item);
        setSelectedPosition(position);
        setModalOpen(true);
      }
    }
  };
  
  // Начать редактирование
  const startEdit = (item, position) => {
    if (user.role !== 'admin') return;
    
    setEditingCell(`${item.id}-${position}`);
    const currentValue = position === 'start' ? item.startPu : 
                        position === 'middle' ? item.middlePu : 
                        item.endPu;
    setEditValue(currentValue || '');
  };
  
  // Сохранить изменения
  const saveEdit = async (item) => {
    try {
      const updateData = {
        startPu: item.startPu,
        middlePu: item.middlePu,
        endPu: item.endPu
      };
      
      const position = editingCell.split('-')[1];
      if (position === 'start') updateData.startPu = editValue || null;
      if (position === 'middle') updateData.middlePu = editValue || null;
      if (position === 'end') updateData.endPu = editValue || null;
      
      await api.put(`/api/network/structure/${item.id}`, updateData);
      
      await loadNetworkStructure();
      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      alert('Ошибка при сохранении');
    }
  };
  
  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };
  
  // Обработка выбора строк
  const handleSelectRow = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };
  
  const handleSelectAll = () => {
    if (selectedIds.length === filteredData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredData.map(item => item.id));
    }
  };
  
  // Удаление выбранных с автообновлением
  const handleDeleteSelected = async () => {
    try {
      const response = await api.post('/api/network/delete-selected', {
        ids: selectedIds,
        password: deletePassword
      });
    
      alert(response.data.message);
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedIds([]);
      setSearchTp(''); // Очищаем поле поиска!
    
      // Автообновление
      await loadNetworkStructure();
    
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const renderPuCell = (item, position) => {
    const puNumber = position === 'start' ? item.startPu : 
                     position === 'middle' ? item.middlePu : 
                     item.endPu;
    const isEditing = editingCell === `${item.id}-${position}`;
    
    if (isEditing) {
      return (
        <div className="edit-cell">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') saveEdit(item);
              if (e.key === 'Escape') cancelEdit();
            }}
            autoFocus
          />
          <button onClick={() => saveEdit(item)} className="save-btn">✓</button>
          <button onClick={cancelEdit} className="cancel-btn">✗</button>
        </div>
      );
    }
    
    return (
      <div 
        className="pu-cell"
        onDoubleClick={() => startEdit(item, position)}
        title={user.role === 'admin' ? 'Двойной клик для редактирования' : ''}
      >
        {puNumber ? (
          <>
            <div 
              className={`status-box ${getStatusColor(
                item.PuStatuses?.find(s => s.puNumber === puNumber && s.position === position)?.status || 'not_checked'
              )}`}
              onClick={() => handleCellClick(item, position)}
            />
            <span className="pu-number">{puNumber}</span>
          </>
        ) : (
          <div className="status-box status-empty">X</div>
        )}
      </div>
    );
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  
  const filteredData = networkData.filter(item => 
    !searchTp || item.tpName.toLowerCase().includes(searchTp.toLowerCase())
  );
  
  // Функция экспорта в Excel
  const exportStructureToExcel = () => {
    if (filteredData.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }

    // Подготавливаем данные
    const exportData = filteredData.map(item => {
      // Находим статусы для каждого ПУ
      const getStatus = (puNumber, position) => {
        if (!puNumber) return 'Пусто';
        const status = item.PuStatuses?.find(s => s.puNumber === puNumber && s.position === position);
        
        switch(status?.status) {
          case 'checked_ok': return 'Проверен ✓';
          case 'checked_error': return 'Ошибка ✗';
          case 'pending_recheck': return 'Ожидает перепроверки';
          case 'not_checked': return 'Не проверен';
          default: return 'Не проверен';
        }
      };

      return {
        'РЭС': item.ResUnit?.name || '',
        'ТП': item.tpName || '',
        'ВЛ': item.vlName || '',
        'ПУ Начало': item.startPu || '-',
        'Статус начала': getStatus(item.startPu, 'start'),
        'ПУ Середина': item.middlePu || '-',
        'Статус середины': getStatus(item.middlePu, 'middle'),
        'ПУ Конец': item.endPu || '-',
        'Статус конца': getStatus(item.endPu, 'end'),
        'Последнее обновление': new Date(item.lastUpdate).toLocaleDateString('ru-RU')
      };
    });

    // Создаем Excel файл
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Устанавливаем ширину колонок
    ws['!cols'] = [
      { wch: 20 }, // РЭС
      { wch: 15 }, // ТП
      { wch: 15 }, // ВЛ
      { wch: 15 }, // ПУ Начало
      { wch: 20 }, // Статус начала
      { wch: 15 }, // ПУ Середина
      { wch: 20 }, // Статус середины
      { wch: 15 }, // ПУ Конец
      { wch: 20 }, // Статус конца
      { wch: 20 }  // Последнее обновление
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Структура сети');
    
    const fileName = `Структура_сети_${selectedRes ? `РЭС_${selectedRes}_` : ''}${new Date().toLocaleDateString('ru-RU').split('.').join('-')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    alert(`Структура сети экспортирована в файл: ${fileName}`);
  };
  
  return (
    <div className="network-structure">
      <h2>Структура сети</h2>
      {user.role === 'admin' && (
        <p className="edit-hint">💡 Двойной клик по номеру счетчика для редактирования</p>
      )}
      
      <div className="structure-controls">
        <div className="search-box">
          <input 
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            name="network-search-tp"
          />
        </div>
        
        <button 
          className="export-btn" 
          onClick={exportStructureToExcel}
        >
          📊 Экспорт в Excel
        </button>
        
        {user.role === 'admin' && selectedIds.length > 0 && (
          <button 
            className="delete-selected-btn"
            onClick={() => setShowDeleteModal(true)}
          >
            🗑️ Удалить выбранные ({selectedIds.length})
          </button>
        )}
      </div>
      
      <div className="status-legend">
        <div><span className="status-box status-ok"></span> Проверен без ошибок</div>
        <div><span className="status-box status-error"></span> Проверен с ошибками</div>
        <div><span className="status-box status-unchecked"></span> Не проверен</div>
        <div><span className="status-box status-pending"></span> Ожидает перепроверки</div>
        <div><span className="status-box status-empty">X</span> Пустая ячейка</div>
      </div>
      
      <div className="structure-table">
        <table>
          <thead>
            <tr>
              {user.role === 'admin' && (
                <th className="checkbox-column">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === filteredData.length && filteredData.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              <th>РЭС</th>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>Начало</th>
              <th>Середина</th>
              <th>Конец</th>
              <th>Дата обновления</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id} className={selectedIds.includes(item.id) ? 'selected' : ''}>
                {user.role === 'admin' && (
                  <td className="checkbox-column">
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => handleSelectRow(item.id)}
                    />
                  </td>
                )}
                <td>{item.ResUnit?.name}</td>
                <td>{item.tpName}</td>
                <td>{item.vlName}</td>
                <td>{renderPuCell(item, 'start')}</td>
                <td>{renderPuCell(item, 'middle')}</td>
                <td>{renderPuCell(item, 'end')}</td>
                <td>{new Date(item.lastUpdate).toLocaleDateString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <ErrorDetailsModal 
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        details={selectedDetails}
        tpName={selectedItem?.tpName}
        vlName={selectedItem?.vlName}
        position={selectedPosition}
      />
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedIds.length} записей.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="new-password"    
                  name="delete-notification-password"  
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteSelected}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Модальное окно с деталями ошибки
function ErrorDetailsModal({ isOpen, onClose, details, tpName, vlName, position }) {
  if (!isOpen || !details) return null;
  
  // Парсим детали если они в формате JSON строки
  let errorSummary = '';
  let parsedDetails = null;
  
  try {
    if (details?.errorDetails) {
      const parsed = JSON.parse(details.errorDetails);
      errorSummary = parsed.summary || details.errorDetails;
      parsedDetails = parsed.details;
    }
  } catch (e) {
    errorSummary = details?.errorDetails || 'Нет данных';
  }
  
 // Парсим фазы из деталей - все зеленые по умолчанию!
// Парсим фазы из деталей - красим ТОЛЬКО явно указанные!
const getPhaseErrors = () => {
  const phases = { A: false, B: false, C: false };
  
  if (parsedDetails) {
    // Проверяем только конкретные фазы
    if (parsedDetails.overvoltage) {
      if (parsedDetails.overvoltage.phase_A && parsedDetails.overvoltage.phase_A.count > 0) phases.A = true;
      if (parsedDetails.overvoltage.phase_B && parsedDetails.overvoltage.phase_B.count > 0) phases.B = true;
      if (parsedDetails.overvoltage.phase_C && parsedDetails.overvoltage.phase_C.count > 0) phases.C = true;
    }
    
    if (parsedDetails.undervoltage) {
      if (parsedDetails.undervoltage.phase_A && parsedDetails.undervoltage.phase_A.count > 0) phases.A = true;
      if (parsedDetails.undervoltage.phase_B && parsedDetails.undervoltage.phase_B.count > 0) phases.B = true;
      if (parsedDetails.undervoltage.phase_C && parsedDetails.undervoltage.phase_C.count > 0) phases.C = true;
    }
  }
  
  // Проверяем текст только на явные упоминания
  if (errorSummary) {
    if (errorSummary.indexOf('Фаза A') !== -1 || errorSummary.indexOf('phase_A') !== -1) phases.A = true;
    if (errorSummary.indexOf('Фаза B') !== -1 || errorSummary.indexOf('phase_B') !== -1) phases.B = true;
    if (errorSummary.indexOf('Фаза C') !== -1 || errorSummary.indexOf('phase_C') !== -1) phases.C = true;
  }
  
  return phases;
};
  
  const phaseErrors = getPhaseErrors();
  
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content error-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Детали проверки ПУ #{details?.puNumber}</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal-body">
          <div className="modal-info">
            <p><strong>ТП:</strong> {tpName}</p>
            <p><strong>Фидер:</strong> {vlName}</p>
            <p><strong>Позиция:</strong> {position === 'start' ? 'Начало' : position === 'middle' ? 'Середина' : 'Конец'}</p>
          </div>
          
          <div className="phase-indicators-large">
            <div className={`phase-indicator ${phaseErrors.A ? 'phase-error' : ''}`}>A</div>
            <div className={`phase-indicator ${phaseErrors.B ? 'phase-error' : ''}`}>B</div>
            <div className={`phase-indicator ${phaseErrors.C ? 'phase-error' : ''}`}>C</div>
          </div>
          
          <div className="error-summary">
            <h4>Обнаруженные отклонения:</h4>
            <div className="error-text">{errorSummary}</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="action-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}


// =====================================================
// КОМПОНЕНТ ЗАГРУЗКИ ФАЙЛОВ
// =====================================================

function FileUpload({ selectedRes }) {
  const [selectedType, setSelectedType] = useState('');
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const { user } = useContext(AuthContext);

  const fileTypes = [
    { id: 'rim_single', label: 'Счетчики РИМ (отдельный файл)' },
    { id: 'rim_mass', label: 'Счетчики РИМ (массовая выгрузка)' },
    { id: 'nartis', label: 'Счетчики Нартис' },
    { id: 'energomera', label: 'Счетчики Энергомера' }
  ];

  const handleFileSelect = (e) => {
    setFiles(Array.from(e.target.files));
    setUploadResult(null);
  };

  const handleUpload = async () => {
  if (!files.length || !selectedType) {
    alert('Выберите тип файла и файлы для загрузки');
    return;
  }
  
  // Определяем resId
  let resIdToUse;
  if (user.role === 'admin') {
    resIdToUse = selectedRes || user.resId || 1;
  } else {
    resIdToUse = user.resId;
  }
  
  if (!resIdToUse) {
    alert('Ошибка: не определен РЭС для загрузки');
    return;
  }
  
  setUploading(true);
  setUploadResult(null);
  setUploadProgress({ current: 0, total: files.length });
  
  const results = [];
  const errors = [];
  let duplicatesCount = 0;
  let successCount = 0;
  let problemsCount = 0;
  let wrongPeriodCount = 0;
  
  // Обрабатываем каждый файл
for (let i = 0; i < files.length; i++) {
  const file = files[i];
  setUploadProgress({ current: i + 1, total: files.length });
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', selectedType);
  formData.append('resId', resIdToUse);
  
  try {
    const response = await api.post('/api/upload/analyze', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    
    // Проверка на разные статусы
    const firstDetail = response.data.details?.[0];
    
    if (firstDetail) {
      if (firstDetail.status === 'duplicate_error') {
        duplicatesCount++;
        results.push({
          fileName: file.name,
          status: 'duplicate',
          message: firstDetail.error
        });
      } else if (firstDetail.status === 'wrong_period') {
        wrongPeriodCount++;
        results.push({
          fileName: file.name,
          status: 'wrong_period',
          message: firstDetail.error
        });
      } else if (firstDetail.status === 'not_in_structure') {
        results.push({
          fileName: file.name,
          status: 'not_found',
          message: 'ПУ не найден в структуре сети'
        });
      } else {
        // Обычная обработка
        if (response.data.errors > 0) {
          problemsCount += response.data.errors;
        } else {
          successCount++;
        }
        
        results.push({
          fileName: file.name,
          status: 'processed',
          ...response.data
        });
      }
    }
    
  } catch (error) {
    errors.push({
      fileName: file.name,
      error: error.response?.data?.error || 'Ошибка загрузки'
    });
  }
}
  
  // Показываем итоговый результат
  setUploadResult({
    success: errors.length === 0,
    totalFiles: files.length,
    successCount,
    problemsCount,
    duplicatesCount,
    wrongPeriodCount,
    errorCount: errors.length,
    results,
    errors
  });
  
  // Формируем итоговое сообщение
  let message = `Обработано файлов: ${files.length}\n`;
  if (successCount > 0) message += `✅ Без ошибок: ${successCount}\n`;
  if (problemsCount > 0) message += `⚠️ С проблемами: ${problemsCount}\n`;
  if (duplicatesCount > 0) message += `🔄 Дубликатов: ${duplicatesCount}\n`;
  if (wrongPeriodCount > 0) message += `📅 Неверный период: ${wrongPeriodCount}\n`;
  if (errors.length > 0) message += `❌ Ошибок загрузки: ${errors.length}`;
  
  alert(message);
  
  // Сбрасываем форму
  setFiles([]);
  setSelectedType('');
  setUploading(false);
  
  // Создаем событие для обновления структуры
  window.dispatchEvent(new CustomEvent('structureUpdated'));
  window.dispatchEvent(new CustomEvent('notificationsUpdated'));
};

  return (
    <div className="file-upload">
      <h2>Загрузка файлов для анализа</h2>
      
      {/* Показываем для какого РЭС загружаем */}
      <div className="upload-info">
        <p>
          <strong>Загрузка для РЭС:</strong> {
            user.role === 'admin' && selectedRes 
              ? `Выбранный РЭС (ID: ${selectedRes})`
              : user.resName || 'Ваш РЭС'
          }
        </p>
        <p className="hint">
          💡 Имя файла должно совпадать с номером ПУ в структуре сети!
        </p>
      </div>
      
      <div className="upload-form">
        <div className="form-group">
          <label>Тип файла</label>
          <select 
            value={selectedType} 
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="">Выберите тип файла</option>
            {fileTypes.map(type => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </div>
        
        {selectedType && (
          <div className="file-input-wrapper">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv"
              multiple
              onChange={handleFileSelect}
            />
            {files.length > 0 && (
              <div className="file-info">
                <p>Выбрано файлов: <strong>{files.length}</strong></p>
                <div className="selected-files">
                  {files.map((file, idx) => (
                    <div key={idx} className="file-item">
                      <span>{file.name}</span>
                      <span className="pu-number">ПУ: {file.name.split('.')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploading && (
              <div className="upload-progress">
                Загружается файл {uploadProgress.current} из {uploadProgress.total}...
              </div>
            )}
          </div>
        )}
        
        <button 
          onClick={handleUpload} 
          disabled={uploading || !files.length || !selectedType}  // ИЗМЕНЕНО
          className="upload-btn"
        >
          {uploading ? `Загрузка ${uploadProgress.current}/${uploadProgress.total}...` : 'Загрузить и анализировать'}
        </button>
      </div>
      
      {/* Результаты загрузки */}
      {uploadResult && (
        <div className={`upload-result ${uploadResult.success ? 'success' : 'error'}`}>
          {uploadResult.success ? (
            <>
              <h3>✅ Анализ завершен</h3>
              <p>Обработано записей: {uploadResult.processed}</p>
              <p>Найдено ошибок: {uploadResult.errors}</p>
              {uploadResult.details && uploadResult.details.length > 0 && (
                <details>
                  <summary>Подробности</summary>
                  <pre>{JSON.stringify(uploadResult.details, null, 2)}</pre>
                </details>
              )}
            </>
          ) : (
            <>
              <h3>❌ Ошибка</h3>
              <p>{uploadResult.error}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ УВЕДОМЛЕНИЙ (ИСПРАВЛЕННЫЙ!)
// =====================================================

function Notifications({ filterType, onSectionChange }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [comment, setComment] = useState('');
  const [checkFromDate, setCheckFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');
  const { user } = useContext(AuthContext);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteNotificationId, setDeleteNotificationId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsNotification, setDetailsNotification] = useState(null);
  const [uploadingPu, setUploadingPu] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]); // ДОБАВЛЕНО!
  const [submitting, setSubmitting] = useState(false);
  
  // Оптимизированная функция загрузки
  const loadNotifications = useCallback(async () => {
    try {
      const response = await api.get('/api/notifications');
      // Фильтруем по переданному типу
      const filtered = response.data.filter(n => {
        if (filterType) return n.type === filterType;
        return true;
      });
      setNotifications(filtered);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    loadNotifications();
     markAsRead();
    
    // Слушаем события обновления
    const handleUpdate = () => loadNotifications();
    
    window.addEventListener('structureUpdated', handleUpdate);
    window.addEventListener('notificationsUpdated', handleUpdate);
    window.addEventListener('dataCleared', handleUpdate);
    
    // Автообновление каждые 30 секунд
    const interval = setInterval(loadNotifications, 30000);
    
    return () => {
      window.removeEventListener('structureUpdated', handleUpdate);
      window.removeEventListener('notificationsUpdated', handleUpdate);
      window.removeEventListener('dataCleared', handleUpdate);
      clearInterval(interval);
    };
  }, [loadNotifications]);

  const markAsRead = async () => {
  try {
    // Отмечаем уведомления как прочитанные при открытии
    await api.put('/api/notifications/mark-read', { 
      type: filterType === 'error' ? 'error' : 
            filterType === 'pending_askue' ? 'pending_askue' : 
            'all'
    });
    
    // Обновляем счетчики
    window.dispatchEvent(new CustomEvent('notificationsUpdated'));
  } catch (error) {
    console.error('Error marking as read:', error);
  }
};

  const handleCompleteWork = async () => {
    const wordCount = comment.trim().split(' ').filter(word => word.length > 0).length;
    if (wordCount < 5) {
      alert('Комментарий должен содержать не менее 5 слов');
      return;
    }

     setSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append('comment', comment);
      formData.append('checkFromDate', checkFromDate);
      
      // Добавляем файлы
      attachedFiles.forEach(file => {
        formData.append('attachments', file);
      });
      
      await api.post(`/api/notifications/${selectedNotification.id}/complete-work`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Закрываем модальное окно сразу
    setShowCompleteModal(false);
    setComment('');
    setAttachedFiles([]);
    setSelectedNotification(null);

      
      alert('Мероприятия отмечены как выполненные');
      setShowCompleteModal(false);
      setComment('');
      setAttachedFiles([]);
      setSelectedNotification(null);
      
      await loadNotifications();
      
    } catch (error) {
      alert('Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
    setSubmitting(false); // ДОБАВИТЬ - разблокируем кнопку в любом случае
  }
};

  const handleDeleteNotification = async () => {
    try {
      await api.delete(`/api/notifications/${deleteNotificationId}`, {
        data: { password: deletePassword }
      });
     
      alert('Уведомление удалено');
      setShowDeleteModal(false);
      setDeletePassword('');
      setDeleteNotificationId(null);
      
      // ВАЖНО: Автообновление после удаления!
      await loadNotifications();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  // Функция загрузки файла прямо из уведомления АСКУЭ
  const handleFileUpload = async (puNumber, notificationData) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Проверяем имя файла
    const fileName = file.name.split('.')[0];
    if (fileName !== puNumber) {
      alert(`Имя файла должно быть ${puNumber}.xls или ${puNumber}.xlsx`);
      return;
    }
    
    setUploadingPu(puNumber);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'rim_single');
    formData.append('resId', user.resId);
    formData.append('requiredPeriod', notificationData.checkFromDate);
    
    try {
      const response = await api.post('/api/upload/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // ПРОВЕРЯЕМ РЕЗУЛЬТАТ!
      if (response.data.details && response.data.details.length > 0) {
        const firstResult = response.data.details[0];
        
        // Проверяем статус
        if (firstResult.status === 'wrong_period') {
          // Показываем ошибку периода
          alert(firstResult.error);
          // НЕ обновляем уведомления, чтобы можно было попробовать снова
          return;
        } else if (firstResult.status === 'duplicate_error') {
          // Показываем ошибку дубликата
          alert(firstResult.error);
          return;
        }
      }
      
      // Если все ок
      alert('Файл успешно загружен и обработан!');
      await loadNotifications();
      window.dispatchEvent(new CustomEvent('structureUpdated'));
      
    } catch (error) {
      alert('Ошибка загрузки: ' + (error.response?.data?.error || error.message));
    } finally {
      setUploadingPu(null);
    }
  };
  
  input.click();
};

  // ИСПРАВЛЕННАЯ функция определения фаз - без регулярных выражений!
  const getPhaseErrors = useCallback((errorDetails) => {
    const phases = { A: false, B: false, C: false };
    
    if (!errorDetails) return phases;
    
    try {
      let data = null;
      let textToAnalyze = '';
      
      // Пытаемся распарсить JSON
      if (typeof errorDetails === 'string') {
        try {
          const parsed = JSON.parse(errorDetails);
          data = parsed.details || parsed;
          textToAnalyze = parsed.summary || errorDetails;
        } catch {
          textToAnalyze = errorDetails;
        }
      } else if (typeof errorDetails === 'object') {
        data = errorDetails.details || errorDetails;
        textToAnalyze = errorDetails.summary || JSON.stringify(errorDetails);
      }
      
      // Проверяем структурированные данные ТОЛЬКО если есть конкретные фазы
      if (data && typeof data === 'object') {
        if (data.overvoltage) {
          if (data.overvoltage.phase_A && data.overvoltage.phase_A.count > 0) phases.A = true;
          if (data.overvoltage.phase_B && data.overvoltage.phase_B.count > 0) phases.B = true;
          if (data.overvoltage.phase_C && data.overvoltage.phase_C.count > 0) phases.C = true;
        }
        
        if (data.undervoltage) {
          if (data.undervoltage.phase_A && data.undervoltage.phase_A.count > 0) phases.A = true;
          if (data.undervoltage.phase_B && data.undervoltage.phase_B.count > 0) phases.B = true;
          if (data.undervoltage.phase_C && data.undervoltage.phase_C.count > 0) phases.C = true;
        }
      }
      
      // Проверяем текст ТОЛЬКО на явные упоминания конкретных фаз
      if (textToAnalyze) {
        // Только если явно написано "Фаза A" или "phase_A"
        if (textToAnalyze.indexOf('Фаза A') !== -1 || textToAnalyze.indexOf('phase_A') !== -1) phases.A = true;
        if (textToAnalyze.indexOf('Фаза B') !== -1 || textToAnalyze.indexOf('phase_B') !== -1) phases.B = true;
        if (textToAnalyze.indexOf('Фаза C') !== -1 || textToAnalyze.indexOf('phase_C') !== -1) phases.C = true;
      }
    } catch (e) {
      console.error('Error parsing phase errors:', e);
    }
    
    return phases;
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  const title = filterType === 'error' ? 'Ожидающие мероприятий' : 
                filterType === 'pending_askue' ? 'Ожидающие проверки АСКУЭ' : 
                'Все уведомления';

  // Фильтрация по ТП
  const filteredNotifications = notifications.filter(notif => {
    if (!searchTp) return true;
    try {
      const data = JSON.parse(notif.message);
      return data.tpName?.toLowerCase().includes(searchTp.toLowerCase());
    } catch {
      return true;
    }
  });

  return (
    <div className="notifications">
      <h2>{title}</h2>
      
      <div className="notifications-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            name="notifications-search-tp"
          />
        </div>
      </div>
      
      <div className="notifications-list">
        {filteredNotifications.map(notif => (
          <div 
            key={notif.id} 
            className={`notification-compact ${notif.type} ${!notif.isRead ? 'unread' : ''}`}
          >
            {/* КОМПАКТНЫЕ УВЕДОМЛЕНИЯ ОБ ОШИБКАХ */}
            {notif.type === 'error' && (() => {
              try {
                const data = JSON.parse(notif.message);
                const phaseErrors = getPhaseErrors(data.details || data.errorDetails);
                
                return (
                  <div className="notification-narrow-content">
                    <div className="notification-phases">
                      <div className={`phase-indicator ${phaseErrors.A ? 'phase-error' : ''}`}>A</div>
                      <div className={`phase-indicator ${phaseErrors.B ? 'phase-error' : ''}`}>B</div>
                      <div className={`phase-indicator ${phaseErrors.C ? 'phase-error' : ''}`}>C</div>
                    </div>
                    
                    <div className="notification-narrow-info">
                      <div className="notification-tp">{data.tpName}</div>
                      <div className="notification-narrow-details">
                        <span className="label">РЭС:</span> {data.resName} | 
                        <span className="label"> ТП:</span> {data.tpName} | 
                        <span className="label"> ВЛ:</span> {data.vlName} | 
                        <span className="label"> Позиция:</span> {
                          data.position === 'start' ? 'Начало' : 
                          data.position === 'middle' ? 'Середина' : 'Конец'
                        }
                      </div>
                      <div className="notification-pu-number">
                        ПУ №: <strong>{data.puNumber}</strong>
                      </div>
                    </div>
                    
                    <div className="notification-narrow-actions">
                      <button 
                        className="btn-details-light"
                        onClick={() => {
                          setDetailsNotification({ ...notif, data });
                          setShowDetailsModal(true);
                        }}
                        title="Подробности"
                      >
                        🔍
                      </button>
                      
                      {user.role === 'res_responsible' && (
                        <button 
                          className="btn-complete"
                          onClick={() => {
                            setSelectedNotification({ id: notif.id, data });
                            setShowCompleteModal(true);
                          }}
                          title="Выполнить мероприятия"
                        >
                          ✅
                        </button>
                      )}
                      
                      {user.role === 'admin' && (
                        <button
                          className="btn-delete"
                          onClick={() => {
                            setDeleteNotificationId(notif.id);
                            setShowDeleteModal(true);
                          }}
                          title="Удалить"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                );
              } catch (e) {
                return <div className="error-text">Ошибка отображения</div>;
              }
            })()}
            
            {/* КОМПАКТНЫЕ УВЕДОМЛЕНИЯ АСКУЭ */}
            {notif.type === 'pending_askue' && (() => {
              try {
                const data = JSON.parse(notif.message);
                return (
                  <div className="notification-compact-content askue">
                    <div className="notification-main-info">
                      <div className="notification-location">
                        <span className="label">ТП:</span> {data.tpName} | 
                        <span className="label"> ПУ №:</span> <strong>{data.puNumber}</strong> | 
                        <span className="label"> Журнал с:</span> <strong>{new Date(data.checkFromDate).toLocaleDateString('ru-RU')}</strong>
                      </div>
                    </div>
                    
                    <div className="notification-actions-row">
                      <div className="notification-buttons">
                        <button 
                          className="btn-upload"
                          onClick={() => handleFileUpload(data.puNumber, data)}
                          disabled={uploadingPu === data.puNumber}
                          title="Загрузить файл"
                        >
                          {uploadingPu === data.puNumber ? '⏳ Загрузка...' : '📤 Загрузить'}
                        </button>
                        
                        <button 
                          className="btn-details"
                          onClick={() => {
                            setDetailsNotification({ ...notif, data });
                            setShowDetailsModal(true);
                          }}
                          title="Подробности"
                        >
                          🔍
                        </button>
                        
                        {user.role === 'admin' && (
                          <button
                            className="btn-delete"
                            onClick={() => {
                              setDeleteNotificationId(notif.id);
                              setShowDeleteModal(true);
                            }}
                            title="Удалить"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              } catch (e) {
                return <div className="error-text">Ошибка отображения</div>;
              }
            })()}

            {/* УВЕДОМЛЕНИЯ О ПРОБЛЕМНЫХ ВЛ */}
{notif.type === 'problem_vl' && (() => {
  try {
    const data = JSON.parse(notif.message);
    return (
      <div className="notification-compact-content problem-vl">
        <div className="problem-vl-alert">
          <span className="critical-icon">🚨</span>
          <div className="problem-vl-header">
            <h4>Критическая проблема!</h4>
            <span className="failure-count">{data.failureCount} неудачных проверок</span>
          </div>
        </div>
        
        <div className="notification-main-info">
          <div className="notification-location">
            <span className="label">РЭС:</span> {data.resName} | 
            <span className="label"> ТП:</span> {data.tpName} | 
            <span className="label"> ВЛ:</span> {data.vlName}
          </div>
          <div className="notification-pu">
            <span className="label">ПУ №:</span> <strong>{data.puNumber}</strong> | 
            <span className="label"> Позиция:</span> {
              data.position === 'start' ? 'Начало' :
              data.position === 'middle' ? 'Середина' : 'Конец'
            }
          </div>
        </div>
        
        <div className="problem-error-details">
          <p className="error-label">Последняя ошибка:</p>
          <p className="error-text">{data.errorDetails}</p>
        </div>
        
        {data.resComment && (
          <div className="problem-res-comment">
            <p className="comment-label">Комментарий РЭС:</p>
            <p className="comment-text">{data.resComment}</p>
          </div>
        )}
        
        <div className="notification-actions-row">
          <div className="notification-buttons">
            <button 
              className="btn-view-problem"
              onClick={() => {
                // Если есть функция смены раздела, используем её
                if (typeof onSectionChange === 'function') {
                  onSectionChange('problem_vl');
                }
              }}
              title="Перейти к проблемным ВЛ"
            >
              📊 К проблемным ВЛ
            </button>
            
            {user.role === 'admin' && (
              <button
                className="btn-delete"
                onClick={() => {
                  setDeleteNotificationId(notif.id);
                  setShowDeleteModal(true);
                }}
                title="Удалить уведомление"
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      </div>
    );
  } catch (e) {
    console.error('Error parsing problem VL notification:', e);
    return <div className="error-text">Ошибка отображения уведомления</div>;
  }
})()}
            
            {/* УСПЕШНЫЕ УВЕДОМЛЕНИЯ */}
            {notif.type === 'success' && (
              <div className="notification-compact-content success">
                <div className="success-icon">✅</div>
                <div className="success-text">{notif.message}</div>
              </div>
            )}

            {/* ИНФОРМАЦИОННЫЕ УВЕДОМЛЕНИЯ */}
            {notif.type === 'info' && (
              <div className="notification-compact-content info">
                <div className="info-icon">ℹ️</div>
                <div className="info-text">{notif.message}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Модальное окно деталей */}
      {showDetailsModal && detailsNotification && (
        <div className="modal-backdrop" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подробная информация</h3>
              <button className="close-btn" onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              {detailsNotification.type === 'error' && (
                <>
                  {/* Показываем фазы в детальном окне */}
                  <div className="phase-indicators-large">
                    {(() => {
                      const phases = { A: false, B: false, C: false };
                      
                      // Проверяем только явные упоминания фаз
                      if (detailsNotification.data.details && typeof detailsNotification.data.details === 'object') {
                        const details = detailsNotification.data.details;
                        if (details.overvoltage) {
                          if (details.overvoltage.phase_A && details.overvoltage.phase_A.count > 0) phases.A = true;
                          if (details.overvoltage.phase_B && details.overvoltage.phase_B.count > 0) phases.B = true;
                          if (details.overvoltage.phase_C && details.overvoltage.phase_C.count > 0) phases.C = true;
                        }
                        if (details.undervoltage) {
                          if (details.undervoltage.phase_A && details.undervoltage.phase_A.count > 0) phases.A = true;
                          if (details.undervoltage.phase_B && details.undervoltage.phase_B.count > 0) phases.B = true;
                          if (details.undervoltage.phase_C && details.undervoltage.phase_C.count > 0) phases.C = true;
                        }
                      }
                      
                      const errorText = detailsNotification.data.errorDetails || '';
                      if (errorText.indexOf('Фаза A') !== -1 || errorText.indexOf('phase_A') !== -1) phases.A = true;
                      if (errorText.indexOf('Фаза B') !== -1 || errorText.indexOf('phase_B') !== -1) phases.B = true;
                      if (errorText.indexOf('Фаза C') !== -1 || errorText.indexOf('phase_C') !== -1) phases.C = true;
                      
                      return (
                        <>
                          <div className={`phase-indicator ${phases.A ? 'phase-error' : ''}`}>A</div>
                          <div className={`phase-indicator ${phases.B ? 'phase-error' : ''}`}>B</div>
                          <div className={`phase-indicator ${phases.C ? 'phase-error' : ''}`}>C</div>
                        </>
                      );
                    })()}
                  </div>
                  
                  <div className="detail-row">
                    <strong>РЭС:</strong> {detailsNotification.data.resName}
                  </div>
                  <div className="detail-row">
                    <strong>ТП:</strong> {detailsNotification.data.tpName}
                  </div>
                  <div className="detail-row">
                    <strong>Фидер:</strong> {detailsNotification.data.vlName}
                  </div>
                  <div className="detail-row">
                    <strong>ПУ №:</strong> {detailsNotification.data.puNumber}
                  </div>
                  <div className="detail-row">
                    <strong>Позиция:</strong> {
                      detailsNotification.data.position === 'start' ? 'Начало' :
                      detailsNotification.data.position === 'middle' ? 'Середина' : 'Конец'
                    }
                  </div>
                  <div className="error-details-box">
                    <strong>Детали ошибки:</strong>
                    <p>{detailsNotification.data.errorDetails}</p>
                  </div>
                </>
              )}
              
              {detailsNotification.type === 'pending_askue' && (
                <>
                  <div className="askue-details-content">
                    <h4>⚡ Требуется снять журнал событий</h4>
                    <div className="detail-row">
                      <strong>ПУ №:</strong> {detailsNotification.data.puNumber}
                    </div>
                    <div className="detail-row">
                      <strong>ТП:</strong> {detailsNotification.data.tpName}
                    </div>
                    <div className="detail-row">
                      <strong>Фидер:</strong> {detailsNotification.data.vlName}
                    </div>
                    <div className="highlight-box">
                      <strong>📅 Журнал событий с даты:</strong>
                      <p>{new Date(detailsNotification.data.checkFromDate).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div className="highlight-box">
                      <strong>💬 Комментарий РЭС:</strong>
                      <p>{detailsNotification.data.completedComment}</p>
                    </div>
                    <div className="detail-row">
                      <strong>Мероприятия выполнены:</strong> {new Date(detailsNotification.data.completedAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="action-btn" onClick={() => setShowDetailsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно для выполнения мероприятий */}
      {showCompleteModal && selectedNotification && (
        <div className="modal-backdrop" onClick={() => setShowCompleteModal(false)}>
          <div className="modal-content complete-work-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Отметить выполнение мероприятий</h3>
              <button className="close-btn" onClick={() => setShowCompleteModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="work-info">
                <p><strong>ТП:</strong> {selectedNotification.data.tpName}</p>
                <p><strong>ВЛ:</strong> {selectedNotification.data.vlName}</p>
                <p><strong>ПУ №:</strong> {selectedNotification.data.puNumber}</p>
              </div>
              
              <div className="form-group">
                <label>Что было выполнено? (минимум 5 слов)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Опишите выполненные работы..."
                  rows={4}
                />
                <small className="word-count">
                  Слов: {comment.trim().split(' ').filter(w => w.length > 0).length} из 5
                </small>
              </div>
              
              <div className="form-group">
                <label>Журнал событий требуется с даты:</label>
                <input
                  type="date"
                  value={checkFromDate}
                  onChange={(e) => setCheckFromDate(e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label>Прикрепить фото/документы (макс. 5 файлов по 10MB)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const files = Array.from(e.target.files).slice(0, 5);
                    setAttachedFiles(files);
                  }}
                />
                {attachedFiles.length > 0 && (
                  <div className="attached-files-list">
                    <p>Выбрано файлов: {attachedFiles.length}</p>
                    {attachedFiles.map((file, idx) => (
                      <div key={idx} className="attached-file-item">
                        {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCompleteModal(false)}>
                Отмена
              <button 
                className="confirm-btn" 
                onClick={handleCompleteWork}
                  disabled={
                  comment.trim().split(' ').filter(w => w.length > 0).length < 5 ||
                  submitting
                }
              >
                {submitting ? 'Отправка...' : 'Подтвердить выполнение'}
                </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить это уведомление.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="new-password"    
                  name="delete-notification-password"  
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteNotification}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ОТЧЕТОВ
// =====================================================

function Reports() {
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [selectedComment, setSelectedComment] = useState(null);

  const [reportType, setReportType] = useState('pending_work');
  const [reportData, setReportData] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');
  
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  useEffect(() => {
    loadReports();
  }, [reportType, dateFrom, dateTo]);

  const loadReports = async () => {
    setLoading(true);
    try {
      let response;
    
      if (reportType === 'problem_vl') {
        // Для проблемных ВЛ используем отдельный endpoint
        response = await api.get('/api/reports/problem-vl', {
          params: { dateFrom, dateTo }
        });
      } else {
        // Для остальных используем существующий endpoint
        response = await api.get('/api/reports/detailed', {
          params: {
            type: reportType,
            dateFrom,
            dateTo
          }
        });
      }
    
    setReportData(response.data);
  } catch (error) {
    console.error('Error loading reports:', error);
    setReportData([]);
  } finally {
    setLoading(false);
  }
};
  
  // Функция для открытия просмотра файлов
  const viewAttachments = (attachments) => {
    
    console.log('Viewing attachments:', attachments);
    
    if (attachments && attachments.length > 0) {
      setSelectedFiles(attachments);
      setCurrentFileIndex(0);
      setShowFileViewer(true);
    }
  };
  
  // Обновленная функция exportToExcel в компоненте Reports
  const exportToExcel = () => {
  if (filteredData.length === 0) {
    alert('Нет данных для экспорта');
    return;
  }

  // Подготавливаем данные для экспорта
  const exportData = filteredData.map(item => {
    const base = {
      'РЭС': item.resName || '',
      'ТП': item.tpName || '',
      'ВЛ': item.vlName || '',
      'Позиция': item.position === 'start' ? 'Начало' : 
                 item.position === 'middle' ? 'Середина' : 'Конец',
      'Номер ПУ': item.puNumber || ''
    };

    // Добавляем специфичные поля в зависимости от типа отчета
    if (reportType === 'problem_vl') {
      return {
        ...base,
        'Количество неудачных проверок': item.failureCount || 0,
        'Дата первого обращения': formatDate(item.firstReportDate),
        'Дата последней проверки': formatDate(item.lastErrorDate),
        'Последняя ошибка': item.lastErrorDetails || '',
        'Статус проблемы': item.status || ''
      };
    } else if (reportType === 'pending_work') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate)
      };
    } else if (reportType === 'pending_askue') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate),
        'Комментарий РЭС': item.resComment || '',
        'Дата завершения мероприятий': formatDate(item.workCompletedDate)
      };
    } else if (reportType === 'completed') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate),
        'Комментарий РЭС': item.resComment || '',
        'Дата завершения мероприятий': formatDate(item.workCompletedDate),
        'Дата перепроверки': formatDate(item.recheckDate),
        'Результат': item.recheckResult === 'ok' ? 'Исправлено' : 'Не исправлено'
      };
    }
  });

  // Создаем новую книгу Excel
  const wb = XLSX.utils.book_new();
  
  // Создаем лист с данными
  const ws = XLSX.utils.json_to_sheet(exportData);
  
  // Устанавливаем ширину колонок в зависимости от типа отчета
  let columnWidths = [
    { wch: 20 }, // РЭС
    { wch: 15 }, // ТП
    { wch: 15 }, // ВЛ
    { wch: 12 }, // Позиция
    { wch: 15 }, // Номер ПУ
  ];
  
  if (reportType === 'problem_vl') {
    columnWidths.push(
      { wch: 25 }, // Количество неудачных проверок
      { wch: 20 }, // Дата первого обращения
      { wch: 20 }, // Дата последней проверки
      { wch: 50 }, // Последняя ошибка
      { wch: 15 }  // Статус проблемы
    );
  } else if (reportType === 'pending_work') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }  // Дата обнаружения
    );
  } else if (reportType === 'pending_askue') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }, // Дата обнаружения
      { wch: 40 }, // Комментарий РЭС
      { wch: 25 }  // Дата завершения мероприятий
    );
  } else if (reportType === 'completed') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }, // Дата обнаружения
      { wch: 40 }, // Комментарий РЭС
      { wch: 25 }, // Дата завершения мероприятий
      { wch: 18 }, // Дата перепроверки
      { wch: 15 }  // Результат
    );
  }
  
  ws['!cols'] = columnWidths;
  
  // Добавляем лист в книгу
  const sheetName = getReportTitle();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // Генерируем имя файла
  const fileName = `Отчет_${sheetName}_${new Date().toLocaleDateString('ru-RU').split('.').join('-')}.xlsx`;
  
  // Сохраняем файл
  XLSX.writeFile(wb, fileName);
  
  // Показываем уведомление
  alert(`Отчет успешно экспортирован в файл: ${fileName}`);
};

  // Вспомогательная функция для форматирования даты
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getReportTitle = () => {
    switch (reportType) {
      case 'pending_work':
        return 'Ожидающие мероприятий';
      case 'pending_askue':
        return 'Ожидающие проверки АСКУЭ';
      case 'completed':
        return 'Завершенные проверки';
      case 'problem_vl':
        return 'Проблемные ВЛ (2+ неудачных проверки)';
      default:
        return 'Отчет';
      }
  };

  // Фильтрация по ТП с мемоизацией
  const filteredData = useMemo(() => 
    reportData.filter(item => 
      !searchTp || item.tpName?.toLowerCase().includes(searchTp.toLowerCase())
    ), [reportData, searchTp]
  );

  if (loading) return <div className="loading">Загрузка отчета...</div>;

  return (
    <div className="reports">
      <h2>Отчеты по проверкам</h2>
      
      <div className="report-controls">
        <div className="control-group">
          <label>Тип отчета:</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="pending_work">Ожидающие мероприятий</option>
            <option value="pending_askue">Ожидающие проверки АСКУЭ</option>
            <option value="completed">Завершенные проверки</option>
            <option value="problem_vl">Проблемные ВЛ (2+ ошибки)</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Период с:</label>
          <input 
            type="date" 
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <label>по:</label>
          <input 
            type="date" 
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <input 
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
          />
        </div>
        
        <button className="export-btn" onClick={exportToExcel}>
          📊 Экспорт в Excel
        </button>
      </div>
      
      <div className="report-summary">
        <h3>{getReportTitle()}</h3>
        <p>Найдено записей: {filteredData.length}</p>
      </div>
      
      <div className="report-table-wrapper" style={{ position: 'relative' }}>
  {loading && (
    <div className="loading-overlay">
      <div className="loading-spinner">
        <div className="spinner"></div>
        <span>Обновление данных...</span>
      </div>
    </div>
  )}
  
  <div className={`report-table ${loading ? 'loading' : ''}`}>
    <table>
      <thead>
        <tr>
          <th>РЭС</th>
          <th>ТП</th>
          <th>ВЛ</th>
          <th>Позиция</th>
          <th>Номер ПУ</th>
          
          {/* Разные колонки для разных типов отчетов */}
          {reportType === 'problem_vl' ? (
            <>
              <th>Кол-во ошибок</th>
              <th>Первое обращение</th>
              <th>Последняя проверка</th>
              <th>Последняя ошибка</th>
              <th>Статус</th>
            </>
          ) : reportType === 'pending_work' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
            </>
          ) : reportType === 'pending_askue' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
              <th>Комментарий РЭС</th>
              <th>Дата завершения мероприятий</th>
            </>
          ) : reportType === 'completed' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
              <th>Комментарий РЭС</th>
              <th>Дата завершения мероприятий</th>
              <th>Дата перепроверки</th>
              <th>Результат</th>
              <th>Файлы</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {filteredData.map((item, idx) => (
          <tr key={idx}>
            <td>{item.resName}</td>
            <td>{item.tpName}</td>
            <td>{item.vlName}</td>
            <td>{item.position === 'start' ? 'Начало' : item.position === 'middle' ? 'Середина' : 'Конец'}</td>
            <td>{item.puNumber}</td>
            
            {/* Данные для проблемных ВЛ */}
            {reportType === 'problem_vl' ? (
              <>
                <td>
                  <span className="failure-count-badge">{item.failureCount}</span>
                </td>
                <td>{new Date(item.firstReportDate).toLocaleDateString('ru-RU')}</td>
                <td>{new Date(item.lastErrorDate).toLocaleDateString('ru-RU')}</td>
                <td className="error-cell">{item.lastErrorDetails}</td>
                <td>
                  <span className={`status-badge ${
                    item.status === 'Активная' ? 'status-active' : 
                    item.status === 'Решена' ? 'status-resolved' : 
                    'status-dismissed'
                  }`}>
                    {item.status}
                  </span>
                </td>
              </>
            
            /* Данные для ожидающих мероприятий */
            ) : reportType === 'pending_work' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
              </>
            
            /* Данные для ожидающих АСКУЭ */
            ) : reportType === 'pending_askue' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
                <td>{item.resComment}</td>
                <td>{new Date(item.workCompletedDate).toLocaleDateString('ru-RU')}</td>
              </>
            
            /* Данные для завершенных проверок */
            ) : reportType === 'completed' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
                <td>{item.resComment}</td>
                <td>{new Date(item.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td>{new Date(item.recheckDate).toLocaleDateString('ru-RU')}</td>
                <td className="status-cell">
                  <span 
                    className={item.recheckResult === 'ok' ? 'status-ok clickable' : 'status-error clickable'}
                    onClick={() => {
                      setSelectedComment({
                        comment: item.resComment,
                        tpName: item.tpName,
                        vlName: item.vlName,
                        puNumber: item.puNumber,
                        result: item.recheckResult
                      });
                      setShowCommentModal(true);
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Нажмите для просмотра комментария"
                  >
                    {item.recheckResult === 'ok' ? '✅ Исправлено' : '❌ Не исправлено'}
                  </span>
                </td>
                <td>
                  {item.attachments && item.attachments.length > 0 ? (
                    <button 
                      className="btn-view-files"
                      onClick={() => viewAttachments(item.attachments)}
                    >
                      📎 {item.attachments.length} файл(ов)
                    </button>
                  ) : (
                    <span className="no-files">—</span>
                  )}
                </td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
      
      {filteredData.length === 0 && (
        <div className="no-data">
          <p>Нет данных для отображения за выбранный период</p>
        </div>
      )}
      
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    
{/* Модальное окно для комментария */}
{showCommentModal && selectedComment && (
  <div className="modal-backdrop" onClick={() => setShowCommentModal(false)}>
    <div className="modal-content comment-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h3>Комментарий РЭС</h3>
        <button className="close-btn" onClick={() => setShowCommentModal(false)}>✕</button>
      </div>
      
      <div className="modal-body">
        <div className="comment-info">
          <p><strong>ТП:</strong> {selectedComment.tpName}</p>
          <p><strong>ВЛ:</strong> {selectedComment.vlName}</p>
          <p><strong>ПУ №:</strong> {selectedComment.puNumber}</p>
          <p><strong>Результат:</strong> 
            <span className={selectedComment.result === 'ok' ? 'status-ok' : 'status-error'}>
              {selectedComment.result === 'ok' ? '✅ Исправлено' : '❌ Не исправлено'}
            </span>
          </p>
        </div>
        
        <div className="comment-content">
          <h4>Выполненные работы:</h4>
          <p>{selectedComment.comment}</p>
        </div>
      </div>
      
      <div className="modal-footer">
        <button className="action-btn" onClick={() => setShowCommentModal(false)}>
          Закрыть
        </button>
      </div>
    </div>
  </div>
)}
</div>
  );

}

// =====================================================
// КОМПОНЕНТ ПРОБЛЕМНЫХ ВЛ (2+ НЕУДАЧНЫХ ПРОВЕРКИ)
// =====================================================

function ProblemVL() {
  const [problemVLs, setProblemVLs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsProblem, setDetailsProblem] = useState(null);

  useEffect(() => {
    loadProblemVLs();
    
    const handleUpdate = () => loadProblemVLs();
    window.addEventListener('problemVLUpdated', handleUpdate);
    
    return () => {
      window.removeEventListener('problemVLUpdated', handleUpdate);
    };
  }, []);

  const loadProblemVLs = async () => {
    try {
      const response = await api.get('/api/problem-vl/list');
      setProblemVLs(response.data);
    } catch (error) {
      console.error('Error loading problem VLs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await api.put(`/api/problem-vl/${selectedProblem.id}/dismiss`, {
        password: deletePassword
      });
      
      alert('Проблема отклонена');
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedProblem(null);
      loadProblemVLs();
    } catch (error) {
      alert('Ошибка: ' + (error.response?.data?.error || error.message));
    }
  };

  if (loading) return <div className="loading">Загрузка проблемных ВЛ...</div>;

  return (
    <div className="problem-vl-container">
      <h2>🚨 Проблемные ВЛ (2+ неудачных проверки)</h2>
      
      <div className="problem-info">
        <p>В этом разделе отображаются ВЛ, которые не прошли проверку 2 и более раз после выполнения мероприятий РЭС.</p>
        <p>Это требует особого внимания и возможного выезда на место.</p>
      </div>
      
      <div className="problem-stats">
        <div className="stat-card critical">
          <h4>Активных проблем</h4>
          <p className="stat-value">{problemVLs.filter(p => p.status === 'active').length}</p>
        </div>
        <div className="stat-card">
          <h4>Всего зарегистрировано</h4>
          <p className="stat-value">{problemVLs.length}</p>
        </div>
      </div>
      
      {problemVLs.length === 0 ? (
        <div className="no-data">
          <p>🎉 Отлично! Нет проблемных ВЛ</p>
        </div>
      ) : (
        <div className="problem-list">
          {problemVLs.map(problem => (
            <div key={problem.id} className="problem-card">
              <div className="problem-header">
                <div>
                  <h3>{problem.tpName} - {problem.vlName}</h3>
                  <span className="res-badge">{problem.ResUnit?.name}</span>
                </div>
                <span className="failure-badge critical">
                  ❌ {problem.failureCount} неудачных проверок
                </span>
              </div>
              
              <div className="problem-details">
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">ПУ №:</span>
                    <span className="value">{problem.puNumber}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Позиция:</span>
                    <span className="value">
                      {problem.position === 'start' ? 'Начало' :
                       problem.position === 'middle' ? 'Середина' : 'Конец'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Первое обращение:</span>
                    <span className="value">
                      {new Date(problem.firstReportDate).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Последняя проверка:</span>
                    <span className="value">
                      {new Date(problem.lastErrorDate).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="problem-error">
                <strong>Последняя ошибка:</strong>
                <p>{problem.lastErrorDetails}</p>
              </div>
              
              {problem.resComment && (
                <div className="problem-comment">
                  <strong>Комментарий РЭС:</strong>
                  <p>{problem.resComment}</p>
                </div>
              )}
              
              <div className="problem-actions">
                <button 
                  className="btn-details"
                  onClick={() => {
                    setDetailsProblem(problem);
                    setShowDetailsModal(true);
                  }}
                >
                  🔍 Подробности
                </button>
                <button 
                  className="btn-dismiss"
                  onClick={() => {
                    setSelectedProblem(problem);
                    setShowDeleteModal(true);
                  }}
                >
                  ✕ Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Модальное окно подтверждения отклонения */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Отклонить проблему</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы уверены, что хотите отклонить эту проблему?</p>
              <div className="problem-summary">
                <p><strong>{selectedProblem?.tpName} - {selectedProblem?.vlName}</strong></p>
                <p>ПУ №{selectedProblem?.puNumber} ({selectedProblem?.failureCount} ошибок)</p>
              </div>
              <p className="warning">⚠️ Это уберет проблему из активного списка!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDismiss}
                disabled={!deletePassword}
              >
                Отклонить проблему
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно с подробностями */}
      {showDetailsModal && detailsProblem && (
        <div className="modal-backdrop" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подробная информация о проблемной ВЛ</h3>
              <button className="close-btn" onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <h4>{detailsProblem.tpName} - {detailsProblem.vlName}</h4>
              
              <div className="detail-section">
                <h5>Общая информация:</h5>
                <div className="detail-row">
                  <strong>РЭС:</strong> {detailsProblem.ResUnit?.name}
                </div>
                <div className="detail-row">
                  <strong>ПУ №:</strong> {detailsProblem.puNumber}
                </div>
                <div className="detail-row">
                  <strong>Позиция:</strong> {
                    detailsProblem.position === 'start' ? 'Начало' :
                    detailsProblem.position === 'middle' ? 'Середина' : 'Конец'
                  }
                </div>
              </div>
              
              <div className="detail-section">
                <h5>История проблемы:</h5>
                <div className="detail-row">
                  <strong>Первое обращение:</strong> {new Date(detailsProblem.firstReportDate).toLocaleString('ru-RU')}
                </div>
                <div className="detail-row">
                  <strong>Последняя проверка:</strong> {new Date(detailsProblem.lastErrorDate).toLocaleString('ru-RU')}
                </div>
                <div className="detail-row">
                  <strong>Количество неудачных проверок:</strong> <span className="failure-count">{detailsProblem.failureCount}</span>
                </div>
              </div>
              
              <div className="error-details-box">
                <strong>Последняя ошибка:</strong>
                <p>{detailsProblem.lastErrorDetails}</p>
              </div>
              
              {detailsProblem.resComment && (
                <div className="comment-box">
                  <strong>Последний комментарий РЭС:</strong>
                  <p>{detailsProblem.resComment}</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="action-btn" onClick={() => setShowDetailsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// =====================================================
// КОМПОНЕНТ НАСТРОЕК С УПРАВЛЕНИЕМ ПОЛЬЗОВАТЕЛЯМИ
// =====================================================

function Settings() {
  const [activeTab, setActiveTab] = useState('structure');
  
  return (
    <div className="settings-container">
      <h2>Настройки системы</h2>
      
      <div className="settings-tabs">
        <button 
          className={activeTab === 'structure' ? 'active' : ''}
          onClick={() => setActiveTab('structure')}
        >
          📁 Структура сети
        </button>
        <button 
          className={activeTab === 'users' ? 'active' : ''}
          onClick={() => setActiveTab('users')}
        >
          👥 Пользователи
        </button>
        <button 
          className={activeTab === 'maintenance' ? 'active' : ''}
          onClick={() => setActiveTab('maintenance')}
        >
          🔧 Обслуживание
        </button>
        <button 
          className={activeTab === 'files' ? 'active' : ''}
          onClick={() => setActiveTab('files')}
        >
          📎 Управление файлами
        </button>
      </div>
      
      <div className="settings-content">
        {activeTab === 'structure' && <StructureSettings />}
        {activeTab === 'users' && <UserSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
        {activeTab === 'files' && <FileManagement />}
      </div>
    </div>
  );
}
// Новый подкомпонент управления файлами
function FileManagement() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  useEffect(() => {
    loadFiles();
  }, []);
  
  const loadFiles = async () => {
    try {
      console.log('Loading files...');
      const response = await api.get('/api/admin/files');
      console.log('Files response:', response.data);
      setFiles(response.data.files);
    } catch (error) {
      console.error('Error loading files:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeleteFile = async () => {
  try {
    // ИЗМЕНИТЬ ЭТУ СТРОКУ - добавить encodeURIComponent
    const publicId = selectedFile.public_id || selectedFile.filename;
    
    await api.delete(`/api/admin/files/${encodeURIComponent(publicId)}`, {
      data: { password: deletePassword }
    });
    
    alert('Файл удален успешно');
    setShowDeleteModal(false);
    setDeletePassword('');
    setSelectedFile(null);
    loadFiles();
    
  } catch (error) {
    console.error('Delete error:', error);
    alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
  }
};
  
  const getTotalSize = () => {
    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    return (totalBytes / 1024 / 1024).toFixed(2);
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  
  return (
    <div className="settings-section">
      <h3>📎 Управление загруженными файлами</h3>
      
      <div className="file-stats">
        <div className="stat-card">
          <h4>Всего файлов</h4>
          <p className="stat-value">{files.length}</p>
        </div>
        <div className="stat-card">
          <h4>Общий размер</h4>
          <p className="stat-value">{getTotalSize()} MB</p>
        </div>
      </div>
      
      <div className="files-grid">
        {files.map((file, idx) => (
          <div key={idx} className="file-card">
            {(file.url.toLowerCase().endsWith('.jpg') || 
              file.url.toLowerCase().endsWith('.jpeg') || 
              file.url.toLowerCase().endsWith('.png') || 
              file.url.toLowerCase().endsWith('.gif')) ? (
              <img src={file.url} alt={file.original_name} className="file-thumbnail" />
            ) : (
              <div className="file-icon">📄</div>
            )}
            
            <div className="file-info">
              <p className="file-name">{file.original_name}</p>
              <p className="file-meta">
                РЭС: {file.resName}<br/>
                ТП: {file.tpName}<br/>
                ПУ: {file.puNumber}<br/>
                Дата: {new Date(file.uploadDate).toLocaleDateString('ru-RU')}
              </p>
            </div>
            
            <div className="file-actions">
              <a 
                href={file.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn-icon"
                title="Открыть"
              >
                👁️
              </a>
              <button 
                onClick={() => {
                  setSelectedFile(file);
                  setShowDeleteModal(true);
                }}
                className="btn-icon danger"
                title="Удалить"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {/* Модальное окно удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления файла</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить файл:</p>
              <p><strong>{selectedFile?.original_name}</strong></p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteFile}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Просмотрщик файлов */}
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    </div>
  );
}
// Подкомпонент настроек структуры
function StructureSettings() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadStats, setUploadStats] = useState(null);
  const [clearOld, setClearOld] = useState(false);
  
  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setMessage('');
    setUploadStats(null);
  };

  const handleUploadStructure = async () => {
    if (!file) {
      alert('Выберите файл');
      return;
    }

    if (clearOld && !confirm('Вы уверены что хотите удалить существующие данные перед загрузкой?')) {
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('clearOld', clearOld);

    try {
      const response = await api.post('/api/network/upload-full-structure', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setMessage('✅ Структура сети успешно загружена!');
      setUploadStats(response.data);
      setFile(null);
      
      // Создаем событие для обновления структуры
      window.dispatchEvent(new CustomEvent('structureUpdated'));
      
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('❌ Ошибка загрузки: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
      setUploadStats(null);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div className="settings-section">
      <h3>📂 Загрузка структуры сети</h3>
      <p className="section-description">
        Загрузите Excel файл со структурой сети. Формат: РЭС | ТП | Фидер | Начало | Середина | Конец
      </p>
      
      <div className="upload-area">
        <input 
          type="file" 
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          id="structure-file"
        />
        <label htmlFor="structure-file" className="file-label">
          {file ? file.name : 'Выберите файл Excel'}
        </label>
      </div>
      
      <div className="settings-option">
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={clearOld}
            onChange={(e) => setClearOld(e.target.checked)}
          />
          <span>Удалить существующие данные перед загрузкой</span>
        </label>
      </div>
      
      <button 
        onClick={handleUploadStructure} 
        disabled={uploading || !file}
        className="primary-btn"
      >
        {uploading ? 'Загрузка...' : '📤 Загрузить структуру'}
      </button>
      
      {message && (
        <div className={message.includes('✅') ? 'success-message' : 'error-message'}>
          {message}
        </div>
      )}
      
      {uploadStats && (
        <div className="upload-stats">
          <h4>Результаты загрузки:</h4>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Обработано:</span>
              <span className="stat-value">{uploadStats.processed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Всего записей:</span>
              <span className="stat-value">{uploadStats.total}</span>
            </div>
          </div>
          {uploadStats.errors && uploadStats.errors.length > 0 && (
            <div className="errors-list">
              <p>⚠️ Ошибки при загрузке:</p>
              <ul>
                {uploadStats.errors.slice(0, 5).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              {uploadStats.errors.length > 5 && (
                <p>... и еще {uploadStats.errors.length - 5} ошибок</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Подкомпонент управления пользователями
function UserSettings() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resList, setResList] = useState([]);
  
  // Форма для создания/редактирования
  const [userForm, setUserForm] = useState({
    fio: '',
    login: '',
    password: '',
    email: '',
    role: 'uploader',
    resId: ''
  });
  
  useEffect(() => {
    loadUsers();
    loadResList();
  }, []);
  
  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/users/list');
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };
  
  const handleCreateUser = async () => {
    try {
      await api.post('/api/users/create', userForm);
      alert('Пользователь создан успешно');
      setShowCreateModal(false);
      setUserForm({
        fio: '',
        login: '',
        password: '',
        email: '',
        role: 'uploader',
        resId: ''
      });
      loadUsers();
    } catch (error) {
      alert('Ошибка создания пользователя: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const handleUpdateUser = async () => {
    try {
      await api.put(`/api/users/${editingUser.id}`, userForm);
      alert('Пользователь обновлен успешно');
      setShowEditModal(false);
      setEditingUser(null);
      loadUsers();
    } catch (error) {
      alert('Ошибка обновления пользователя: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const handleDeleteUser = async (userId) => {
    if (!confirm('Удалить пользователя?')) return;
    
    const password = prompt('Введите пароль администратора:');
    if (!password) return;
    
    try {
      await api.delete(`/api/users/${userId}`, { data: { password } });
      alert('Пользователь удален');
      loadUsers();
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const startEdit = (user) => {
    setEditingUser(user);
    setUserForm({
      fio: user.fio,
      login: user.login,
      password: '',
      email: user.email,
      role: user.role,
      resId: user.resId || ''
    });
    setShowEditModal(true);
  };
  
  const createTestUsers = async () => {
    try {
      const response = await api.post('/api/users/create-test');
      alert(response.data.message);
      loadUsers();
    } catch (error) {
      alert('Ошибка создания тестовых пользователей');
    }
  };
  
  return (
    <div className="settings-section">
      <div className="section-header">
        <h3>👥 Управление пользователями</h3>
        <div className="header-actions">
          <button onClick={createTestUsers} className="secondary-btn">
            🧪 Создать тестовых
          </button>
          <button onClick={() => setShowCreateModal(true)} className="primary-btn">
            ➕ Новый пользователь
          </button>
        </div>
      </div>
      
      <div className="users-table-container">
        {loading ? (
          <div className="loading">Загрузка...</div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>РЭС</th>
                <th>Email</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.fio}</td>
                  <td><strong>{user.login}</strong></td>
                  <td>
                    <span className={`role-badge role-${user.role}`}>
                      {user.role === 'admin' ? '👑 Админ' : 
                       user.role === 'uploader' ? '📤 Загрузчик' : 
                       '⚡ Ответственный'}
                    </span>
                  </td>
                  <td>{user.ResUnit?.name || '-'}</td>
                  <td>{user.email}</td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        onClick={() => startEdit(user)}
                        className="btn-icon"
                        title="Редактировать"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => handleDeleteUser(user.id)}
                        className="btn-icon danger"
                        title="Удалить"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {/* Модальное окно создания пользователя */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content user-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Создание пользователя</h3>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>ФИО</label>
                <input
                  type="text"
                  value={userForm.fio}
                  onChange={(e) => setUserForm({...userForm, fio: e.target.value})}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              
              <div className="form-group">
                <label>Логин</label>
                <input
                  type="text"
                  value={userForm.login}
                  onChange={(e) => setUserForm({...userForm, login: e.target.value})}
                  placeholder="ivanov"
                />
              </div>
              
              <div className="form-group">
                <label>Пароль</label>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                  placeholder="Минимум 6 символов"
                />
              </div>
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                  placeholder="ivanov@res.ru"
                />
              </div>
              
              <div className="form-group">
                <label>Роль</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                >
                  <option value="admin">Администратор</option>
                  <option value="uploader">Загрузчик АСКУЭ</option>
                  <option value="res_responsible">Ответственный РЭС</option>
                </select>
              </div>
              
              {userForm.role !== 'admin' && (
                <div className="form-group">
                  <label>РЭС</label>
                  <select
                    value={userForm.resId}
                    onChange={(e) => setUserForm({...userForm, resId: e.target.value})}
                  >
                    <option value="">Выберите РЭС</option>
                    {resList.map(res => (
                      <option key={res.id} value={res.id}>{res.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                Отмена
              </button>
              <button 
                className="primary-btn" 
                onClick={handleCreateUser}
                disabled={!userForm.fio || !userForm.login || !userForm.password || !userForm.email}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно редактирования (аналогично создания) */}
      {showEditModal && (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal-content user-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Редактирование пользователя</h3>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>ФИО</label>
                <input
                  type="text"
                  value={userForm.fio}
                  onChange={(e) => setUserForm({...userForm, fio: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Логин</label>
                <input
                  type="text"
                  value={userForm.login}
                  onChange={(e) => setUserForm({...userForm, login: e.target.value})}
                  disabled
                />
              </div>
              
              <div className="form-group">
                <label>Новый пароль (оставьте пустым чтобы не менять)</label>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                  placeholder="Оставьте пустым"
                />
              </div>
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Роль</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                >
                  <option value="admin">Администратор</option>
                  <option value="uploader">Загрузчик АСКУЭ</option>
                  <option value="res_responsible">Ответственный РЭС</option>
                </select>
              </div>
              
              {userForm.role !== 'admin' && (
                <div className="form-group">
                  <label>РЭС</label>
                  <select
                    value={userForm.resId}
                    onChange={(e) => setUserForm({...userForm, resId: e.target.value})}
                  >
                    <option value="">Выберите РЭС</option>
                    {resList.map(res => (
                      <option key={res.id} value={res.id}>{res.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowEditModal(false)}>
                Отмена
              </button>
              <button 
                className="primary-btn" 
                onClick={handleUpdateUser}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Подкомпонент обслуживания системы
function MaintenanceSettings() {
  const [clearing, setClearing] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearPassword, setClearPassword] = useState('');
  
  const handleClearAll = async () => {
    setClearing(true);
    try {
      const response = await api.delete('/api/network/clear-all', {
        data: { password: clearPassword }
      });
      
      alert('✅ Все данные успешно удалены!');
      setShowClearModal(false);
      setClearPassword('');
      
      // Создаем событие для обновления всех компонентов
      window.dispatchEvent(new CustomEvent('dataCleared'));
      
    } catch (error) {
      alert('❌ Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
      setClearing(false);
    }
  };
  
  return (
    <div className="settings-section">
      <h3>🔧 Обслуживание системы</h3>
      
      <div className="maintenance-card danger">
        <h4>⚠️ Полная очистка данных</h4>
        <p>Удаляет всю структуру сети, статусы проверок, уведомления и историю.</p>
        <p className="warning-text">Это действие необратимо!</p>
        <button 
          onClick={() => setShowClearModal(true)}
          disabled={clearing}
          className="danger-btn"
        >
          {clearing ? 'Удаление...' : '🗑️ Очистить все данные'}
        </button>
      </div>
      
      <div className="maintenance-card">
        <h4>📊 Статистика системы</h4>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Версия системы:</span>
            <span className="stat-value">2.0.1</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">База данных:</span>
            <span className="stat-value">PostgreSQL</span>
          </div>
        </div>
      </div>
      
      {/* Модальное окно для удаления всех данных */}
      {showClearModal && (
        <div className="modal-backdrop" onClick={() => setShowClearModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение полной очистки</h3>
              <button className="close-btn" onClick={() => setShowClearModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="warning">⚠️ ВНИМАНИЕ! Будут удалены:</p>
              <ul>
                <li>Вся структура сети</li>
                <li>Все статусы проверок</li>
                <li>Все уведомления</li>
                <li>Вся история загрузок</li>
                <li>Вся история проверок</li>
              </ul>
              <p className="warning">Это действие НЕЛЬЗЯ отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={clearPassword}
                  onChange={(e) => setClearPassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowClearModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleClearAll}
                disabled={!clearPassword || clearing}
              >
                {clearing ? 'Удаление...' : 'Удалить всё'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// ОСНОВНОЕ ПРИЛОЖЕНИЕ
// =====================================================

// =====================================================
// Компонент для просмотра файлов
// =====================================================
function FileViewer({ files, currentIndex, onClose, onNext, onPrev }) {
  console.log('FileViewer files:', files);
  console.log('Current file:', files[currentIndex]);
  
  const currentFile = files[currentIndex];
  const url = currentFile.url.toLowerCase();
  const isImage = url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.gif');
  const isPdf = url.endsWith('.pdf');
  
  return (
    <div className="modal-backdrop file-viewer-backdrop" onClick={onClose}>
      <div className="file-viewer-container" onClick={e => e.stopPropagation()}>
        <div className="file-viewer-header">
          <h3>Просмотр файлов ({currentIndex + 1} из {files.length})</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="file-viewer-content">
          {isImage ? (
            <img 
              src={currentFile.url} 
              alt={currentFile.original_name}
              className="file-viewer-image"
            />
          ) : isPdf ? (
            <div className="pdf-viewer">
              <iframe 
                src={currentFile.url} 
                width="100%" 
                height="600px"
                title={currentFile.original_name}
              />
              <a 
                href={currentFile.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="pdf-download-link"
              >
                📥 Открыть PDF в новой вкладке
              </a>
            </div>
          ) : (
            <div className="file-not-supported">
              <p>Предпросмотр недоступен</p>
              <a 
                href={currentFile.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="download-link"
              >
                📥 Скачать файл
              </a>
            </div>
          )}
        </div>
        
        <div className="file-viewer-info">
          <p><strong>Имя файла:</strong> {currentFile.original_name}</p>
          <p><strong>Загружен:</strong> {new Date(currentFile.uploaded_at).toLocaleString('ru-RU')}</p>
        </div>
        
        {files.length > 1 && (
          <div className="file-viewer-navigation">
            <button onClick={onPrev} className="nav-btn">
              ← Предыдущий
            </button>
            <button onClick={onNext} className="nav-btn">
              Следующий →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ЗАГРУЖЕННЫХ ДОКУМЕНТОВ
// =====================================================

function UploadedDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const { user } = useContext(AuthContext);
  const [deleteRecordId, setDeleteRecordId] = useState(null); // ДОБАВИТЬ
  const [showDeleteRecordModal, setShowDeleteRecordModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]); // ДОБАВИТЬ - для выбранных записей
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false); // ДОБАВИТЬ - для массового удаления
  
  useEffect(() => {
    loadDocuments();
  }, []);
  
  const loadDocuments = async () => {
    try {
      const response = await api.get('/api/documents/list');
      setDocuments(response.data);
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleViewFile = (files) => {
    setSelectedFiles(files);
    setCurrentFileIndex(0);
    setShowFileViewer(true);
  };
  
  const handleDeleteFile = async () => {
    try {
      await api.delete(`/api/documents/${selectedFile.recordId}/${selectedFile.fileIndex}`, {
        data: { password: deletePassword }
      });
      
      alert('Файл удален успешно');
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedFile(null);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  if (loading) return <div className="loading">Загрузка документов...</div>;
  
  return (
    <div className="uploaded-documents">
      <h2>📄 Загруженные документы</h2>
      
      <div className="documents-info">
        <p>Всего документов: <strong>{documents.reduce((sum, doc) => sum + (doc.attachments?.length || 0), 0)}</strong></p>
      </div>
      
      <div className="documents-table">
        <table>
          <thead>
            <tr>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>ПУ №</th>
              <th>Загрузил</th>
              <th>Дата загрузки</th>
              <th>Комментарий</th>
              <th>Статус</th>
              <th>Файлы</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.tpName}</td>
                <td>{doc.vlName}</td>
                <td><strong>{doc.puNumber}</strong></td>
                <td>{doc.uploadedBy}</td>
                <td>{new Date(doc.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td className="comment-cell">{doc.resComment}</td>
                <td>
                  <span className={`status-badge status-${doc.status}`}>
                    {doc.status === 'completed' ? '✅ Завершен' : '⏳ На проверке'}
                  </span>
                </td>
                <td>
                  <span className="file-count">{doc.attachments?.length || 0} файл(ов)</span>
                </td>
                <td>
                  <div className="action-buttons">
                    {doc.attachments && doc.attachments.length > 0 && (
                      <button 
                        className="btn-view"
                        onClick={() => handleViewFile(doc.attachments)}
                        title="Просмотреть"
                      >
                        👁️
                      </button>
                    )}
                    {user.role === 'admin' && doc.attachments && doc.attachments.map((file, idx) => (
                      <button 
                        key={idx}
                        className="btn-delete-small"
                        onClick={() => {
                          setSelectedFile({ ...file, recordId: doc.id, fileIndex: idx });
                          setShowDeleteModal(true);
                        }}
                        title={`Удалить ${file.original_name}`}
                      >
                        🗑️
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {documents.length === 0 && (
        <div className="no-data">
          <p>Пока нет загруженных документов</p>
        </div>
      )}

const handleDeleteRecord = async () => {
    try {
      await api.delete(`/api/documents/record/${deleteRecordId}`, {
        data: { password: deletePassword }
      });
      
      alert('Запись удалена успешно');
      setShowDeleteRecordModal(false);
      setDeletePassword('');
      setDeleteRecordId(null);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  return (
    <div className="uploaded-documents">
      <h2>📄 Загруженные документы</h2>
      
      <div className="documents-info">
        <p>Всего документов: <strong>{documents.reduce((sum, doc) => sum + (doc.attachments?.length || 0), 0)}</strong></p>
      </div>
      
      <div className="documents-table">
        <table>
          <thead>
            <tr>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>ПУ №</th>
              <th>Загрузил</th>
              <th>Дата загрузки</th>
              <th>Комментарий</th>
              <th>Статус</th>
              <th>Файлы</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.tpName}</td>
                <td>{doc.vlName}</td>
                <td><strong>{doc.puNumber}</strong></td>
                <td>{doc.uploadedBy}</td>
                <td>{new Date(doc.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td className="comment-cell">{doc.resComment}</td>
                <td>
                  <span className={`status-badge status-${doc.status}`}>
                    {doc.status === 'completed' ? '✅ Завершен' : '⏳ На проверке'}
                  </span>
                </td>
                <td>
                  <span className="file-count">{doc.attachments?.length || 0} файл(ов)</span>
                </td>
                <td>
                  <div className="action-buttons">
                    {doc.attachments && doc.attachments.length > 0 && (
                      <button 
                        className="btn-view"
                        onClick={() => handleViewFile(doc.attachments)}
                        title="Просмотреть"
                      >
                        👁️
                      </button>
                    )}
                    {user.role === 'admin' && (
                      <>
                        <button 
                          className="btn-delete-small"
                          onClick={() => {
                            setDeleteRecordId(doc.id);
                            setShowDeleteRecordModal(true);
                          }}
                          title="Удалить запись"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


  // ДОБАВИТЬ - обработка выбора записей
  const handleSelectRecord = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.length === documents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(documents.map(doc => doc.id));
    }
  };

  // ДОБАВИТЬ - массовое удаление
  const handleBulkDelete = async () => {
    try {
      await api.post('/api/documents/delete-bulk', {
        ids: selectedIds,
        password: deletePassword
      });
      
      alert(`Удалено записей: ${selectedIds.length}`);
      setShowBulkDeleteModal(false);
      setDeletePassword('');
      setSelectedIds([]);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="uploaded-documents">
      <h2>📄 Загруженные документы</h2>
      
      <div className="documents-controls">
        <div className="documents-info">
          <p>Всего документов: <strong>{documents.reduce((sum, doc) => sum + (doc.attachments?.length || 0), 0)}</strong></p>
        </div>
        
        {/* ДОБАВИТЬ - кнопка удаления выбранных */}
        {user.role === 'admin' && selectedIds.length > 0 && (
          <button 
            className="delete-selected-btn"
            onClick={() => setShowBulkDeleteModal(true)}
          >
            🗑️ Удалить выбранные ({selectedIds.length})
          </button>
        )}
      </div>
      
      <div className="documents-table">
        <table>
          <thead>
            <tr>
              {/* ДОБАВИТЬ - колонку с чекбоксом */}
              {user.role === 'admin' && (
                <th className="checkbox-column">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === documents.length && documents.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              <th>ТП</th>
              <th>ВЛ</th>
              <th>ПУ №</th>
              <th>Загрузил</th>
              <th>Дата загрузки</th>
              <th>Комментарий</th>
              <th>Статус</th>
              <th>Файлы</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className={selectedIds.includes(doc.id) ? 'selected' : ''}>
                {/* ДОБАВИТЬ - чекбокс для каждой записи */}
                {user.role === 'admin' && (
                  <td className="checkbox-column">
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(doc.id)}
                      onChange={() => handleSelectRecord(doc.id)}
                    />
                  </td>
                )}
                <td>{doc.tpName}</td>
                <td>{doc.vlName}</td>
                <td><strong>{doc.puNumber}</strong></td>
                <td>{doc.uploadedBy}</td>
                <td>{new Date(doc.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td className="comment-cell">{doc.resComment}</td>
                <td>
                  <span className={`status-badge status-${doc.status}`}>
                    {doc.status === 'completed' ? '✅ Завершен' : '⏳ На проверке'}
                  </span>
                </td>
                <td>
                  <span className="file-count">{doc.attachments?.length || 0} файл(ов)</span>
                </td>
                <td>
                  <div className="action-buttons">
                    {doc.attachments && doc.attachments.length > 0 && (
                      <button 
                        className="btn-view"
                        onClick={() => handleViewFile(doc.attachments)}
                        title="Просмотреть"
                      >
                        👁️
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* ДОБАВИТЬ - модальное окно массового удаления */}
      {showBulkDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedIds.length} записей.</p>
              <p>Все связанные файлы также будут удалены.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleBulkDelete}
                disabled={!deletePassword}
              >
                Удалить выбранные
              </button>
            </div>
          </div>
        </div>
      )}


      
      {/* Модальное окно удаления записи */}
      {showDeleteRecordModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteRecordModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления записи</h3>
              <button className="close-btn" onClick={() => setShowDeleteRecordModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить всю запись вместе со всеми файлами.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteRecordModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteRecord}
                disabled={!deletePassword}
              >
                Удалить запись
              </button>
            </div>
          </div>
        </div>
      )}

      
      {/* Модальное окно удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления файла</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить файл:</p>
              <p><strong>{selectedFile?.original_name}</strong></p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteFile}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Просмотрщик файлов */}
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    </div>
  );
}


// экспорт файлов

export default function App() {
  const [user, setUser] = useState(null);
  const [activeSection, setActiveSection] = useState('structure');
  const [selectedRes, setSelectedRes] = useState(null);
  const [resList, setResList] = useState([]);

  // Оптимизированная проверка токена
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/api/auth/me')
        .then(response => {
          setUser(response.data.user);
          setSelectedRes(response.data.user.resId);
        })
        .catch(() => {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUser({
              id: payload.id,
              role: payload.role,
              resId: payload.resId
            });
            setSelectedRes(payload.resId);
          } catch (error) {
            localStorage.removeItem('token');
          }
        });
    }
  }, []);

  useEffect(() => {
    if (user && user.role === 'admin') {
      loadResList();
    }
  }, [user]);

  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };

  const handleLogin = useCallback((userData) => {
    setUser({
      id: userData.id,
      fio: userData.fio,
      role: userData.role,
      resId: userData.resId,
      resName: userData.resName
    });
    if (userData.resId) {
      setSelectedRes(userData.resId);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setSelectedRes(null);
  };

  if (!user) {
    return <LoginForm onLogin={handleLogin} />;
  }

  const renderContent = () => {
  switch (activeSection) {
    case 'structure':
      return <NetworkStructure selectedRes={selectedRes} />;
    case 'upload':
      return <FileUpload selectedRes={selectedRes} />;
    case 'tech_pending':
      return <Notifications filterType="error" onSectionChange={setActiveSection} />;
    case 'askue_pending':
      return <Notifications filterType="pending_askue" onSectionChange={setActiveSection} />;
    case 'problem_vl':
      return <ProblemVL />;
    case 'documents':
      return <UploadedDocuments />;
    case 'reports':
      return <Reports />;
    case 'settings':
      return <Settings />;
    default:
      return <NetworkStructure selectedRes={selectedRes} />;
  }
};

  return (
    <AuthContext.Provider value={{ user, selectedRes }}>
      <div className="app">
        <MainMenu 
          activeSection={activeSection} 
          onSectionChange={setActiveSection}
          userRole={user.role}
        />
        
        <div className="main-content">
          <header className="app-header">
            <div className="header-left">
              <h1>Система контроля уровня напрежения в сетях 0,4 кВ</h1>
              {user.role === 'admin' && (
                <select 
                  value={selectedRes || ''}
                  onChange={(e) => setSelectedRes(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">Все РЭСы</option>
                  {resList.map(res => (
                    <option key={res.id} value={res.id}>{res.name}</option>
                  ))}
                </select>
              )}
              {user.resId && (
                <span className="res-name">
                  {resList.find(r => r.id === user.resId)?.name || user.resName}
                </span>
              )}
            </div>
            
            <div className="header-right">
              <span>{user.fio}</span>
              <span className="user-role">
                ({user.role === 'admin' ? 'Администратор' : 
                  user.role === 'uploader' ? 'Загрузчик' : 'Ответственный'})
              </span>
              <button onClick={handleLogout} className="logout-btn">
                Выйти
              </button>
            </div>
          </header>
          
          <main className="content">
            {renderContent()}
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
