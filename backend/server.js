// =====================================================
// ПОЛНЫЙ BACKEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Всё в одном файле для удобства переноса между чатами
// =====================================================

// Устанавливаем кодировку
process.env.LANG = 'ru_RU.UTF-8';
process.env.LC_ALL = 'ru_RU.UTF-8';
process.env.NODE_OPTIONS = '--encoding=utf-8';

console.log('Server starting...');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

const express = require('express');
console.log('Express loaded');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');

// =====================================================
// КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// =====================================================

require('dotenv').config();
const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
// Health check для Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RES Management Backend is running',
    version: '1.0.0'
  });
});
// Создаем папку uploads если её нет
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// =====================================================
// ПОДКЛЮЧЕНИЕ К БД (PostgreSQL на Render)
// =====================================================

const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/dbname', {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false,
    charset: 'utf8',
    client_encoding: 'UTF8'
  },
  logging: false
});

// =====================================================
// МОДЕЛИ ДАННЫХ
// =====================================================

// 1. Модель РЭС (районов)
const ResUnit = sequelize.define('ResUnit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
});

// 2. Модель пользователей
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fio: {
    type: DataTypes.STRING,
    allowNull: false
  },
  login: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'uploader', 'res_responsible'),
    allowNull: false
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// 3. Модель структуры сети (ТП и ВЛ)
const NetworkStructure = sequelize.define('NetworkStructure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  endPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  middlePu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastUpdate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// 4. Модель статусов ПУ (приборов учета)
const PuStatus = sequelize.define('PuStatus', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('not_checked', 'checked_ok', 'checked_error', 'pending_recheck', 'empty'),
  defaultValue: 'not_checked'
},
  errorDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastCheck: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// 5. Модель уведомлений
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fromUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  toUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  puStatusId: {
    type: DataTypes.INTEGER,
    references: {
      model: PuStatus,
      key: 'id'
    }
  },
  type: {
  type: DataTypes.ENUM('error', 'success', 'info', 'pending_check', 'pending_askue'),
  allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  errorData: {
    type: DataTypes.JSON,
    allowNull: true
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  checkFromDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// 6. Модель истории загрузок
const UploadHistory = sequelize.define('UploadHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileType: {
    type: DataTypes.ENUM('rim_single', 'rim_mass', 'nartis', 'energomera'),
    allowNull: false
  },
  processedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  errorCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('processing', 'completed', 'failed'),
    defaultValue: 'processing'
  }
});

// =====================================================
// СВЯЗИ МЕЖДУ МОДЕЛЯМИ
// =====================================================

User.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.hasMany(PuStatus, { foreignKey: 'networkStructureId' });
PuStatus.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
Notification.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });
Notification.belongsTo(ResUnit, { foreignKey: 'resId' });
Notification.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(PuStatus, { foreignKey: 'puStatusId' });
UploadHistory.belongsTo(User, { foreignKey: 'userId' });
UploadHistory.belongsTo(ResUnit, { foreignKey: 'resId' });

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

// Хеширование паролей
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

// Валидация пароля
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки ролей
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
};

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Email сервис
const createEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.mail.ru',
    port: process.env.MAIL_PORT || 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
};

// =====================================================
// API РОУТЫ
// =====================================================

// 1. АВТОРИЗАЦИЯ
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    const user = await User.findOne({ 
      where: { login },
      include: [ResUnit]
    });
    
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        resId: user.resId,
        
      },
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        fio: user.fio,
        role: user.role,
        resId: user.resId,
        resName: user.ResUnit?.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. ПОЛУЧЕНИЕ СПИСКА РЭС
app.get('/api/res/list', authenticateToken, async (req, res) => {
  try {
    const resList = await ResUnit.findAll();
    res.json(resList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ПОЛУЧЕНИЕ СТРУКТУРЫ СЕТИ
app.get('/api/network/structure/:resId?', authenticateToken, async (req, res) => {
  try {
    const resId = req.params.resId || req.user.resId;
    
    // Если не админ, может видеть только свой РЭС
    if (req.user.role !== 'admin' && resId != req.user.resId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // НОВОЕ: Адлерский РЭС (id=2) также видит СИРИУС (id=8)
    let whereClause = {};
    if (resId) {
      if (resId == 2 || req.user.resId == 2) {
        // Если смотрим Адлерский РЭС или пользователь из Адлерского - показываем и СИРИУС
        whereClause = { resId: { [Op.in]: [2, 8] } };
      } else {
        whereClause = { resId };
      }
    }
    
    const structures = await NetworkStructure.findAll({
      where: whereClause,
      include: [
        {
          model: PuStatus,
          required: false,
          attributes: ['id', 'puNumber', 'position', 'status', 'errorDetails', 'lastCheck'] // явно указываем поля
        },
        ResUnit
      ],
      order: [['tpName', 'ASC'], ['vlName', 'ASC']]
    });
    
    res.json(structures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ЗАГРУЗКА СТРУКТУРЫ СЕТИ (только админ)
app.post('/api/network/upload-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      // Парсим данные и создаем записи
      for (const row of data) {
        const resName = row['РЭС'] || row['RES'];
        const res = await ResUnit.findOne({ where: { name: resName } });
        
        if (res) {
          // Создаем или обновляем структуру
          await NetworkStructure.upsert({
            resId: res.id,
            tpName: row['Наименование ТП'] || row['TP'],
            vlName: row['Наименование ВЛ'] || row['VL'],
            startPu: row['Начало'] || row['Start'] || null,
            endPu: row['Конец'] || row['End'] || null,
            middlePu: row['Середина'] || row['Middle'] || null
          });
        }
      }
      
      // Удаляем файл после обработки
      fs.unlinkSync(req.file.path);
      
      res.json({ message: 'Structure uploaded successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// ОБНОВЛЕНИЕ структуры сети (только админ)
app.put('/api/network/structure/:id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { startPu, middlePu, endPu } = req.body;
      
      await NetworkStructure.update({
        startPu: startPu || null,
        middlePu: middlePu || null,
        endPu: endPu || null,
        lastUpdate: new Date()
      }, {
        where: { id: req.params.id }
      });
      
      res.json({ success: true, message: 'Структура обновлена' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 5. ЗАГРУЗКА ФАЙЛОВ ДЛЯ АНАЛИЗА
app.post('/api/upload/analyze',
  authenticateToken,
  checkRole(['admin', 'uploader']),
  upload.single('file'),
  async (req, res) => {
    try {
      const { type } = req.body;
      const userId = req.user.id;
      const resId = req.user.role === 'admin' ? req.body.resId : req.user.resId;
      
      // Создаем запись в истории
      const uploadRecord = await UploadHistory.create({
        userId,
        resId,
        fileName: req.file.originalname,
        fileType: type,
        status: 'processing'
      });
      
      // Запускаем анализ (заглушка - замени на реальный Python скрипт)
      const analysisResult = await analyzeFile(req.file.path, type, req.file.originalname);
      
      // Обновляем статусы ПУ
      for (const result of analysisResult.processed) {
        await updatePuStatus(result.puNumber, result.status, result.error);
      }
      
      // Обновляем историю
      await uploadRecord.update({
        processedCount: analysisResult.processed.length,
        errorCount: analysisResult.errors.length,
        status: 'completed'
      });
      
      // Отправляем уведомления
      if (analysisResult.errors.length > 0) {
        await createNotifications(userId, resId, analysisResult.errors);
      }

      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (err) {
        console.error('Error deleting uploaded file:', err);
      }
      
      res.json({
        message: 'File processed successfully',
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 4.5 ЗАГРУЗКА ПОЛНОЙ СТРУКТУРЫ СЕТИ С ОБНОВЛЕНИЕМ
app.post('/api/network/upload-full-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      // Маппинг РЭСов
      let processed = 0;
      let errors = [];
      
      // Опционально: очищаем старые данные
      if (req.body.clearOld === 'true') {
        await NetworkStructure.destroy({ where: {}, transaction });
      }
      
      // Обрабатываем каждую строку
      for (const row of data) {
        try {
          // Ищем РЭС по полному имени из Excel
          const resName = row['РЭС'];
          const res = await ResUnit.findOne({ 
            where: { name: resName },
            transaction 
          });
          
          if (!res) {
            errors.push(`Неизвестный РЭС: ${resName}`);
            continue;
          }
          
          // Создаем или обновляем запись
          await NetworkStructure.upsert({
            resId: res.id,  // Используем найденный ID из базы
            tpName: row['ТП'] || '',
            vlName: row['Фидер'] || '',
            startPu: row['Начало'] ? String(row['Начало']) : null,
            endPu: row['Конец'] ? String(row['Конец']) : null,
            middlePu: row['Середина'] ? String(row['Середина']) : null
          }, {
            transaction
          });
          
          processed++;
          
          // Создаем статусы для новых ПУ
          const positions = [
            { pu: row['Начало'], pos: 'start' },
            { pu: row['Конец'], pos: 'end' },
            { pu: row['Середина'], pos: 'middle' }
          ];
          
          for (const { pu, pos } of positions) {
            if (pu) {
              await PuStatus.findOrCreate({
                where: { puNumber: String(pu) },
                defaults: {
                  position: pos,
                  status: 'not_checked'
                },
                transaction
              });
            }
          }
          
        } catch (err) {
          errors.push(`Ошибка в строке ${row['ТП']}-${row['Фидер']}: ${err.message}`);
        }
      }
      
      await transaction.commit();
      
      // Удаляем файл
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        message: `Загружено ${processed} записей из ${data.length}`,
        processed,
        total: data.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : [] // Первые 10 ошибок
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// 6. ПОЛУЧЕНИЕ УВЕДОМЛЕНИЙ
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const whereClause = req.user.role === 'admin' 
      ? {} 
      : { toUserId: req.user.id };
    
    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'fromUser' },
        { model: User, as: 'toUser' },
        ResUnit,
        NetworkStructure
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. ОТМЕТИТЬ УВЕДОМЛЕНИЕ КАК ПРОЧИТАННОЕ
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await Notification.update(
      { isRead: true },
      { where: { id: req.params.id } }
    );
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ОТПРАВКА УВЕДОМЛЕНИЯ О ВЫПОЛНЕННЫХ МЕРОПРИЯТИЯХ
app.post('/api/notifications/work-completed', authenticateToken, checkRole(['res_responsible']), async (req, res) => {
  try {
    const { networkStructureId, message } = req.body;
    
    // Найти всех загрузчиков этого РЭС
    const uploaders = await User.findAll({
      where: {
        resId: req.user.resId,
        role: 'uploader'
      }
    });
    
    // Создать уведомления для каждого загрузчика
    for (const uploader of uploaders) {
      await Notification.create({
        fromUserId: req.user.id,
        toUserId: uploader.id,
        resId: req.user.resId,
        networkStructureId,
        type: 'info',
        message: `Мероприятия выполнены: ${message}`
      });
    }
    
    res.json({ message: 'Notifications sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. ПОЛУЧЕНИЕ ОТЧЕТОВ
app.get('/api/reports/summary', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate, resId } = req.query;
    
    const whereClause = {};
    if (startDate) whereClause.createdAt = { [Op.gte]: new Date(startDate) };
    if (endDate) whereClause.createdAt = { ...whereClause.createdAt, [Op.lte]: new Date(endDate) };
    if (resId) whereClause.resId = resId;
    
    const uploadStats = await UploadHistory.findAll({
      where: whereClause,
      include: [User, ResUnit],
      order: [['createdAt', 'DESC']]
    });
    
    const errorStats = await PuStatus.count({
      where: { status: 'checked_error' },
      include: [{
        model: NetworkStructure,
        where: resId ? { resId } : {}
      }]
    });
    
    const pendingStats = await NetworkStructure.count({
      where: resId ? { resId } : {},
      include: [{
        model: PuStatus,
        where: { status: 'checked_error' }
      }]
    });
    
    res.json({
      uploads: uploadStats,
      totalErrors: errorStats,
      pendingChecks: pendingStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Отметить мероприятия как выполненные
app.post('/api/notifications/:id/complete-work', authenticateToken, checkRole(['res_responsible']), async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { comment, checkFromDate } = req.body;
    
    if (!comment || comment.trim().length < 10) {
      return res.status(400).json({ error: 'Комментарий должен быть не менее 10 символов' });
    }
    
    // Находим уведомление
    const notification = await Notification.findByPk(req.params.id);
    if (!notification) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }
    
    // Парсим данные об ошибке
    const errorData = JSON.parse(notification.message);
    
    // Обновляем статус ПУ на pending_recheck
    await PuStatus.update(
      { status: 'pending_recheck' },
      { 
        where: { puNumber: errorData.puNumber },
        transaction
      }
    );
    
    // Помечаем старое уведомление как прочитанное
    await notification.update({ isRead: true }, { transaction });
    
    // Создаем новое уведомление для АСКУЭ
    const askueUsers = await User.findAll({
      where: {
        resId: notification.resId,
        role: 'uploader'
      }
    });
    
    const askueMessage = {
      puNumber: errorData.puNumber,
      position: errorData.position,
      tpName: errorData.tpName,
      vlName: errorData.vlName,
      resName: errorData.resName,
      checkFromDate: checkFromDate || new Date().toISOString().split('T')[0],
      completedComment: comment,
      completedBy: req.user.id,
      completedAt: new Date()
    };
    
    for (const askueUser of askueUsers) {
      await Notification.create({
        fromUserId: req.user.id,
        toUserId: askueUser.id,
        resId: notification.resId,
        networkStructureId: notification.networkStructureId,
        type: 'pending_askue',
        message: JSON.stringify(askueMessage),
        isRead: false
      }, { transaction });
    }
    
    await transaction.commit();
    res.json({ success: true, message: 'Мероприятия отмечены как выполненные' });
    
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ АНАЛИЗА
// =====================================================

// Заглушка для анализа файлов (замени на реальный Python)
// Анализ файлов через Python скрипты
async function analyzeFile(filePath, type, originalFileName = null) {
  return new Promise((resolve, reject) => {
    let scriptPath;
    
    switch(type) {
      case 'rim_single':
        scriptPath = path.join(__dirname, 'analyzers', 'rim_single.py');
        break;
      case 'rim_mass':
        scriptPath = path.join(__dirname, 'analyzers', 'rim_mass_analyzer.py');
        break;
      case 'nartis':
        scriptPath = path.join(__dirname, 'analyzers', 'nartis_analyzer.py');
        break;
      case 'energomera':
        scriptPath = path.join(__dirname, 'analyzers', 'energomera_analyzer.py');
        break;
      default:
        return resolve({
          processed: [],
          errors: ['Неизвестный тип анализатора']
        });
    }
    
    // Пробуем запустить Python
let python;
try {
  python = spawn('python3', [scriptPath, filePath]);
  console.log('Python3 spawn created successfully');
} catch (err) {
  console.error('Failed to spawn python3, trying python:', err);
  try {
    python = spawn('python', [scriptPath, filePath]);
    console.log('Python spawn created successfully');
  } catch (err2) {
    console.error('Both python3 and python failed:', err2);
    return resolve({
      processed: [],
      errors: ['Python не установлен на сервере']
    });
  }
}

console.log('Running Python script:', scriptPath);
console.log('Analyzing file:', filePath);

// Проверяем существование Python скрипта
if (!fs.existsSync(scriptPath)) {
  console.error('Python script not found:', scriptPath);
  return resolve({
    processed: [],
    errors: [`Python скрипт не найден: ${scriptPath}`]
  });
}

let output = '';
let errorOutput = '';

python.stdout.on('data', (data) => {
  output += data.toString();
  console.log('Python stdout chunk:', data.toString());
});

python.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.error('Python stderr:', data.toString());
});

python.on('error', (error) => {
  console.error('Python process error:', error);
  return resolve({
    processed: [],
    errors: [`Ошибка запуска Python: ${error.message}`]
  });
});

python.on('close', async (code) => {
  console.log('Python process closed with code:', code);
  console.log('Final output length:', output.length);
  console.log('Final output:', output);
  console.log('Final errors:', errorOutput);
  
  if (code !== 0) {
    return resolve({
      processed: [],
      errors: [`Ошибка анализа (код ${code}): ${errorOutput}`]
    });
  }
  
  try {
    const result = JSON.parse(output);
    console.log('Parsed result:', JSON.stringify(result));
    
    if (result.success) {
  const processed = [];
  const errors = [];
  
  const fileName = originalFileName 
    ? path.basename(originalFileName, path.extname(originalFileName))
    : path.basename(filePath, path.extname(filePath));
  
  // Ищем ПУ в структуре сети
  const networkStructure = await NetworkStructure.findOne({
    where: {
      [Op.or]: [
        { startPu: fileName },
        { endPu: fileName },
        { middlePu: fileName }
      ]
    }
  });
  
  if (networkStructure) {
    // Определяем позицию
    let position = 'start';
    if (networkStructure.endPu === fileName) position = 'end';
    else if (networkStructure.middlePu === fileName) position = 'middle';
    
    // Создаем или обновляем статус ПУ
    const [puStatus, created] = await PuStatus.upsert({
      puNumber: fileName,
      networkStructureId: networkStructure.id,
      position: position,
      status: result.has_errors ? 'checked_error' : 'checked_ok',
      errorDetails: result.summary,
      lastCheck: new Date()
    });
    
    console.log(`PU ${fileName} ${created ? 'created' : 'updated'} with status: ${result.has_errors ? 'ERROR' : 'OK'}`);
  } else {
    console.log('NetworkStructure not found for PU:', fileName);
  }
  
  processed.push({
    puNumber: fileName,
    status: result.has_errors ? 'checked_error' : 'checked_ok',
    error: result.has_errors ? result.summary : null
  });
  
  if (result.has_errors) {
    errors.push({
      puNumber: fileName,
      error: result.summary,
      details: result.details  // <-- ДОБАВЬ ЭТО
    });
    console.log('Added error for notification:', fileName); // <-- добавь для отладки
}
  }
  
  // Удаляем файл после обработки
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Error deleting file:', err);
  }
  
  resolve({ processed, errors });
} else {
      resolve({
        processed: [],
        errors: [result.error]
      });
    }
  } catch (e) {
    console.error('Failed to parse Python output:', output);
    resolve({
      processed: [],
      errors: [`Ошибка парсинга результата: ${e.message}`]
    });
  }
});
});  // <-- ДОБАВИТЬ: закрываем Promise
}  // <-- ДОБАВИТЬ: закрываем функцию analyzeFile
    
  


// Обновление статуса ПУ
async function updatePuStatus(puNumber, status, errorDetails) {
  const pu = await PuStatus.findOne({ where: { puNumber } });
  if (pu) {
    await pu.update({
      status,
      errorDetails,
      lastCheck: new Date()
    });
  }
}

// Создание уведомлений об ошибках с деталями
async function createNotifications(fromUserId, resId, errors) {
  console.log('Creating notifications for errors:', errors);
  const responsibles = await User.findAll({
    where: {
      resId,
      role: 'res_responsible'
    }
  });
  
  for (const errorInfo of errors) {
    // Находим структуру сети для этого ПУ
    const networkStructure = await NetworkStructure.findOne({
      where: {
        [Op.or]: [
          { startPu: errorInfo.puNumber },
          { middlePu: errorInfo.puNumber },
          { endPu: errorInfo.puNumber }
        ]
      },
      include: [ResUnit]
    });
    
    if (networkStructure) {
      let position = 'start';
      if (networkStructure.middlePu === errorInfo.puNumber) position = 'middle';
      else if (networkStructure.endPu === errorInfo.puNumber) position = 'end';
      
      const errorData = {
        puNumber: errorInfo.puNumber,
        position: position,
        tpName: networkStructure.tpName,
        vlName: networkStructure.vlName,
        resName: networkStructure.ResUnit.name,
        errorDetails: errorInfo.error
      };
      
      for (const responsible of responsibles) {
        await Notification.create({
          fromUserId,
          toUserId: responsible.id,
          resId,
          networkStructureId: networkStructure.id,
          type: 'error',
          message: JSON.stringify(errorData),
          isRead: false
        });
      }
    }
  }
}
// =====================================================
// ИНИЦИАЛИЗАЦИЯ БД И ЗАПУСК СЕРВЕРА
// =====================================================

async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    
    // Синхронизация моделей
    await sequelize.sync({ alter: true });
    
    // Создаем РЭСы если их нет
    const resCount = await ResUnit.count();
    if (resCount === 0) {
      const resList = [
        'Краснополянский РЭС',
        'Адлерский РЭС',
        'Хостинский РЭС',
        'Сочинский РЭС',
        'Дагомысский РЭС',
        'Лазаревский РЭС',
        'Туапсинский РЭС'
      ];
      
      for (const resName of resList) {
        await ResUnit.create({ name: resName });
      }
      console.log('RES units created');
    }
    
    // Создаем СИРИУС <-- ВОТ ТУТ ВСТАВЛЯЕШЬ
    try {
      const [sirius, created] = await ResUnit.findOrCreate({
        where: { name: 'СИРИУС' },
        defaults: { name: 'СИРИУС' }
      });
      console.log('SIRIUS added/checked', created ? 'created' : 'exists');
    } catch (err) {
      console.error('Error creating SIRIUS:', err);
    }
    
    // ДОБАВЬТЕ ЭТО - удаляем опечатку СИРИСУС
    try {
      const deleted = await ResUnit.destroy({ 
        where: { name: 'СИРИСУС' } 
      });
      if (deleted > 0) {
        console.log('Removed SIRISUS typo');
      }
    } catch (err) {
      console.error('Error removing SIRISUS:', err);
    }
    
    console.log('Database initialization complete');
    
    // Создаем админа если его нет
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      await User.create({
        fio: 'Администратор',
        login: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@res.ru'
      });
      console.log('Admin user created');
    }
    
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
} // <-- Конец функции

// Запуск сервера
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

// Обработка ошибок
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
