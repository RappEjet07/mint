
const auth = require('./auth');
auth.getSession().then(cookies => {
  console.log('Fetched Cookies:', cookies);
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
