package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	_ "github.com/lib/pq"
)

var (
	mu      sync.Mutex
	db      *sql.DB
)

func initDB() {
	var err error
	user := os.Getenv("DB_USER")
	dbname := os.Getenv("DB_NAME")
	host := os.Getenv("DB_HOST")
	password := os.Getenv("DB_PASSWORD")

	connStr := fmt.Sprintf(
		"user=%s password=%s dbname=%s host=%s sslmode=require",
		user, password, dbname, host,
	)
	
	fmt.Print("Connecting to database with connection string: ", connStr)
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatal(err)
	}

	// Ensure the counter table exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS counter (count INT)`)
	if err != nil {
		log.Fatal(err)
	}

	// Initialize the counter if not present
	var count int
	err = db.QueryRow(`SELECT count FROM counter`).Scan(&count)
	if err == sql.ErrNoRows {
		_, err = db.Exec(`INSERT INTO counter (count) VALUES (0)`)
		if err != nil {
			log.Fatal(err)
		}
	} else if err != nil {
		log.Fatal(err)
	}
}
func countHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	// Increment the count in the database
	_, err := db.Exec(`UPDATE counter SET count = count + 1`)
	if err != nil {
		http.Error(w, "Failed to update count", http.StatusInternalServerError)
		return
	}

	// Retrieve the updated count
	var currentCount int
	err = db.QueryRow(`SELECT count FROM counter`).Scan(&currentCount)
	if err != nil {
		http.Error(w, "Failed to retrieve count", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"count": currentCount})
}

func main() {
	initDB()
	defer db.Close()

	http.HandleFunc("/api/count", countHandler)

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello, world!!")
	})

	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
