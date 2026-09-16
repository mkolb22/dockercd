// dockercd-web-password-hash creates an Argon2id verifier for the local Web
// user registry without accepting a password through arguments or environment.
package main

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"unicode/utf8"

	"github.com/mkolb22/dockercd/web/internal/localauth"
	"golang.org/x/term"
)

const maxPasswordInputBytes = 1024

var errPasswordInterrupted = errors.New("password entry interrupted")

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return errors.New("password input must be an interactive terminal")
	}
	password, err := readPassword("Password: ")
	if err != nil {
		return err
	}
	defer clear(password)
	confirmation, err := readPassword("Confirm password: ")
	if err != nil {
		return err
	}
	defer clear(confirmation)
	if subtle.ConstantTimeCompare(password, confirmation) != 1 {
		return errors.New("password confirmation does not match")
	}
	verifier, err := localauth.HashPassword(password)
	if err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, verifier)
	return nil
}

func readPassword(prompt string) ([]byte, error) {
	fileDescriptor := int(os.Stdin.Fd())
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGHUP, syscall.SIGTERM)
	defer signal.Stop(interrupts)
	state, err := term.MakeRaw(fileDescriptor)
	if err != nil {
		return nil, fmt.Errorf("preparing password terminal: %w", err)
	}
	fmt.Fprint(os.Stderr, prompt)
	return waitForPassword(fileDescriptor, state, readRawPassword, term.Restore, interrupts)
}

type passwordReadResult struct {
	value []byte
	err   error
}

func waitForPassword(fileDescriptor int, state *term.State, read func(int) ([]byte, error), restore func(int, *term.State) error, interrupts <-chan os.Signal) ([]byte, error) {
	results := make(chan passwordReadResult, 1)
	go func() {
		value, readErr := read(fileDescriptor)
		results <- passwordReadResult{value: value, err: readErr}
	}()
	select {
	case received := <-results:
		restoreErr := restore(fileDescriptor, state)
		fmt.Fprintln(os.Stderr)
		if restoreErr != nil {
			clear(received.value)
			return nil, fmt.Errorf("restoring password terminal: %w", restoreErr)
		}
		if received.err != nil {
			return nil, fmt.Errorf("reading password: %w", received.err)
		}
		return received.value, nil
	case <-interrupts:
		// The terminal entered raw mode before the goroutine was created. The
		// goroutine only reads bytes and cannot alter terminal state after this
		// restoration, even if cancellation wins before its first read.
		_ = restore(fileDescriptor, state)
		fmt.Fprintln(os.Stderr)
		return nil, errPasswordInterrupted
	}
}

func readRawPassword(_ int) ([]byte, error) {
	return readRawPasswordFrom(os.Stdin)
}

func readRawPasswordFrom(reader io.Reader) ([]byte, error) {
	input := make([]byte, 0, 64)
	buffer := make([]byte, 1)
	overlong := false
	for {
		count, err := reader.Read(buffer)
		if err != nil {
			clear(input)
			return nil, err
		}
		if count != 1 {
			continue
		}
		switch buffer[0] {
		case '\r', '\n':
			if overlong {
				clear(input)
				return nil, fmt.Errorf("password must be at most %d bytes", maxPasswordInputBytes)
			}
			if !utf8.Valid(input) {
				clear(input)
				return nil, errors.New("password must be valid UTF-8")
			}
			return input, nil
		case 3: // Ctrl-C is input in raw mode.
			clear(input)
			return nil, errPasswordInterrupted
		case 8, 127:
			if len(input) > 0 {
				_, size := utf8.DecodeLastRune(input)
				if size == 0 {
					size = 1
				}
				for index := len(input) - size; index < len(input); index++ {
					input[index] = 0
				}
				input = input[:len(input)-size]
			}
		default:
			if len(input) < maxPasswordInputBytes {
				input = append(input, buffer[0])
			} else {
				overlong = true
			}
		}
	}
}

func clear(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
